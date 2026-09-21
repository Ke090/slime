const canvas = document.getElementById('slimeCanvas');
const ctx = canvas.getContext('2d');
const playground = document.getElementById('playground');
const hint = document.getElementById('touchHint');

const MODES = {
  jelly: { color: ['#96eaff', '#55c6ed'], spring: 0.075, damping: 0.84, follow: 0.24, stretch: 1.0, bounce: 1.1 },
  sticky: { color: ['#b8efa5', '#63cd91'], spring: 0.035, damping: 0.9, follow: 0.14, stretch: 1.45, bounce: 0.7 },
  mochi: { color: ['#ffd0e1', '#ef8bac'], spring: 0.055, damping: 0.81, follow: 0.19, stretch: 1.18, bounce: 1.4 }
};

let modeName = 'jelly';
let dpr = 1, width = 0, height = 0;
let pointer = { active: false, id: null, x: 0, y: 0, startX: 0, startY: 0, speed: 0 };
let shape = { x: 0, y: 0, vx: 0, vy: 0, sx: 1, sy: 1, vsx: 0, vsy: 0, pullX: 0, pullY: 0, blink: 0, surprised: 0, wobble: 1 };
let muted = false, audioContext = null, lastInteraction = performance.now();

function resize() {
  const rect = playground.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
  width = rect.width; height = rect.height; canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!shape.x) reset(false);
}

function baseSize() { return Math.min(width * 0.34, height * 0.29, 210); }
function reset(sound = true) {
  shape.x = width / 2; shape.y = height * .55; shape.vx = shape.vy = 0;
  shape.sx = shape.sy = 1; shape.vsx = shape.vsy = 0; shape.pullX = shape.pullY = 0;
  shape.wobble = 1.4; shape.surprised = 0; pointer.active = false;
  if (sound) playSound('release', .7);
}

function insideSlime(x, y) {
  const r = baseSize();
  const rx = r * 1.12 * shape.sx + Math.abs(shape.pullX) * .34;
  const ry = r * .82 * shape.sy + Math.abs(shape.pullY) * .18;
  return ((x - shape.x) / rx) ** 2 + ((y - shape.y) / ry) ** 2 < 1.25;
}

playground.addEventListener('pointerdown', (e) => {
  if (pointer.active || !insideSlime(e.offsetX, e.offsetY)) return;
  e.preventDefault(); playground.setPointerCapture(e.pointerId);
  Object.assign(pointer, { active: true, id: e.pointerId, x: e.offsetX, y: e.offsetY, startX: e.offsetX, startY: e.offsetY, speed: 0 });
  shape.surprised = 1; shape.vsy += .08; shape.vsx -= .04; lastInteraction = performance.now();
  hint.classList.add('hidden'); playSound('tap');
});

playground.addEventListener('pointermove', (e) => {
  if (!pointer.active || e.pointerId !== pointer.id) return;
  e.preventDefault(); const dx = e.offsetX - pointer.x, dy = e.offsetY - pointer.y;
  pointer.speed = Math.hypot(dx, dy); pointer.x = e.offsetX; pointer.y = e.offsetY; lastInteraction = performance.now();
});

function release(e) {
  if (!pointer.active || (e && e.pointerId !== pointer.id)) return;
  const distance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
  pointer.active = false; shape.wobble = Math.min(2.5, .7 + distance / 100); shape.vx -= shape.pullX * .065; shape.vy -= shape.pullY * .065;
  shape.pullX = shape.pullY = 0; shape.surprised = distance > 70 ? .8 : 0; playSound('release', Math.min(1.4, .7 + distance / 230));
}
playground.addEventListener('pointerup', release); playground.addEventListener('pointercancel', release);

function roundedBlobPath(cx, cy, rx, ry, pullX, pullY, t) {
  const points = 28, coords = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const influence = Math.max(0, Math.cos(a - Math.atan2(pullY, pullX))) ** 5;
    const jiggle = Math.sin(a * 3 + t * .006) * shape.wobble * 1.8 + Math.sin(a * 5 - t * .004) * shape.wobble;
    coords.push([cx + Math.cos(a) * (rx + jiggle) + pullX * influence, cy + Math.sin(a) * (ry + jiggle) + pullY * influence]);
  }
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const prev = coords[(i + points - 1) % points], cur = coords[i];
    const mx = (prev[0] + cur[0]) / 2, my = (prev[1] + cur[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(prev[0], prev[1], mx, my);
  }
  const last = coords[points - 1], first = coords[0]; ctx.quadraticCurveTo(last[0], last[1], (last[0] + first[0]) / 2, (last[1] + first[1]) / 2); ctx.closePath();
}

function draw(t) {
  ctx.clearRect(0, 0, width, height); const r = baseSize();
  const rx = r * 1.12 * shape.sx, ry = r * .82 * shape.sy;
  ctx.save(); ctx.translate(0, Math.sin(t * .002) * (pointer.active ? 0 : shape.wobble));
  ctx.beginPath(); ctx.ellipse(shape.x, shape.y + ry * .82, rx * .72, Math.max(9, ry * .13), 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(83,106,142,.13)'; ctx.filter = 'blur(8px)'; ctx.fill(); ctx.filter = 'none';
  roundedBlobPath(shape.x, shape.y, rx, ry, shape.pullX, shape.pullY, t);
  const colors = MODES[modeName].color; const grad = ctx.createRadialGradient(shape.x - rx * .36, shape.y - ry * .48, 5, shape.x, shape.y, rx * 1.2);
  grad.addColorStop(0, colors[0]); grad.addColorStop(.7, colors[1]); grad.addColorStop(1, colors[1]); ctx.fillStyle = grad;
  ctx.shadowColor = colors[1] + '55'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 9; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.save(); ctx.clip();
  const shine = ctx.createLinearGradient(0, shape.y - ry, 0, shape.y); shine.addColorStop(0,'rgba(255,255,255,.72)'); shine.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle = shine; ctx.fillRect(shape.x-rx,shape.y-ry,rx*2,ry);
  ctx.beginPath(); ctx.ellipse(shape.x-rx*.38,shape.y-ry*.46,rx*.18,ry*.11,-.5,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.6)';ctx.fill();
  ctx.restore(); drawFace(rx, ry); ctx.restore();
  shape.wobble *= .986; shape.surprised *= .97; requestAnimationFrame(loop);
}

function drawFace(rx, ry) {
  const stretch = Math.min(1.75, shape.sx); const faceY = shape.y - ry * .02;
  const eyeGap = rx * .27 * stretch, eyeY = faceY - ry * .12; ctx.fillStyle = '#53657e';
  const squish = shape.sy < .78; const dizzy = pointer.active && pointer.speed > 16;
  if (squish) {
    ctx.lineWidth=5; ctx.lineCap='round'; ctx.strokeStyle='#53657e';
    [-1,1].forEach(s => {ctx.beginPath();ctx.moveTo(shape.x+s*eyeGap-6,eyeY);ctx.lineTo(shape.x+s*eyeGap+6,eyeY);ctx.stroke();});
  } else if (dizzy) {
    ctx.font=`900 ${Math.max(17,ry*.15)}px sans-serif`;ctx.textAlign='center';ctx.fillText('×',shape.x-eyeGap,eyeY+6);ctx.fillText('×',shape.x+eyeGap,eyeY+6);
  } else {
    const eh = Math.max(7, ry * .105 * (shape.blink ? .2 : 1));
    [-1,1].forEach(s => {ctx.beginPath();ctx.ellipse(shape.x+s*eyeGap,eyeY,Math.max(5,rx*.035),eh,0,0,Math.PI*2);ctx.fill();});
  }
  ctx.strokeStyle='#53657e';ctx.lineWidth=Math.max(4,rx*.025);ctx.lineCap='round';ctx.beginPath();
  if (shape.surprised > .3) ctx.ellipse(shape.x,faceY+ry*.21,rx*.045,ry*.07,0,0,Math.PI*2);
  else {ctx.moveTo(shape.x-rx*.09,faceY+ry*.16);ctx.quadraticCurveTo(shape.x,faceY+ry*.27,shape.x+rx*.11,faceY+ry*.14);} ctx.stroke();
  ctx.beginPath();ctx.ellipse(shape.x-eyeGap-rx*.025,eyeY-ry*.035,rx*.012,ry*.025,0,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.85)';ctx.fill();
  ctx.beginPath();ctx.ellipse(shape.x+eyeGap-rx*.025,eyeY-ry*.035,rx*.012,ry*.025,0,0,Math.PI*2);ctx.fill();
}

function loop(t) {
  const p = MODES[modeName], r = baseSize();
  if (pointer.active) {
    const dx = pointer.x - pointer.startX, dy = pointer.y - pointer.startY;
    const max = r * p.stretch; const len = Math.hypot(dx,dy) || 1, scale = Math.min(1,max/len);
    const tx=dx*scale, ty=dy*scale; shape.pullX += (tx-shape.pullX)*p.follow; shape.pullY += (ty-shape.pullY)*p.follow;
    const horiz=Math.abs(shape.pullX)/r, vert=shape.pullY/r;
    shape.sx += ((1+horiz*.45+Math.max(0,vert)*.35)-shape.sx)*.15; shape.sy += ((1-horiz*.22-Math.max(0,vert)*.28)-shape.sy)*.15;
    shape.x += ((width/2+shape.pullX*.12)-shape.x)*.06; shape.y += ((height*.55+shape.pullY*.1)-shape.y)*.06;
  } else {
    shape.vsx += (1-shape.sx)*p.spring; shape.vsy += (1-shape.sy)*p.spring; shape.vsx*=p.damping;shape.vsy*=p.damping;shape.sx+=shape.vsx;shape.sy+=shape.vsy;
    shape.vx+=(width/2-shape.x)*p.spring*.4;shape.vy+=(height*.55-shape.y)*p.spring*.4;shape.vx*=p.damping;shape.vy*=p.damping;shape.x+=shape.vx;shape.y+=shape.vy;
    shape.pullX*=.78;shape.pullY*=.78;
    if (performance.now()-lastInteraction>12000 && Math.random()<.002) {shape.vsy=-.07*p.bounce;shape.vy=-2.6*p.bounce;shape.wobble=1;shape.blink=1;setTimeout(()=>shape.blink=0,350);lastInteraction=performance.now()-7000;}
  }
  draw(t);
}

function playSound(type, pitch=1) {
  if (muted) return;
  try {
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)(); const now=audioContext.currentTime;
    const osc=audioContext.createOscillator(), gain=audioContext.createGain(), filter=audioContext.createBiquadFilter();
    osc.type='sine'; osc.frequency.setValueAtTime((type==='tap'?210:310)*pitch,now);osc.frequency.exponentialRampToValueAtTime((type==='tap'?130:180)*pitch,now+.16);
    filter.type='lowpass';filter.frequency.value=700;gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.13,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.2);
    osc.connect(filter).connect(gain).connect(audioContext.destination);osc.start(now);osc.stop(now+.22);
  } catch (_) { /* Audio is an optional enhancement. */ }
}

document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => {
  modeName=button.dataset.mode;document.querySelectorAll('.mode').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  shape.wobble=1.7;shape.vsy=-.09;playSound('release',modeName==='sticky'?.75:modeName==='mochi'?1.2:1);
}));
document.getElementById('soundButton').addEventListener('click', function(){muted=!muted;this.classList.toggle('muted',muted);this.setAttribute('aria-pressed',muted);this.setAttribute('aria-label',muted?'音を出す':'音を消す');document.getElementById('soundIcon').textContent=muted?'×':'♪';if(!muted)playSound('tap');});
document.getElementById('resetButton').addEventListener('click',()=>reset(true));
window.addEventListener('resize',resize);resize();requestAnimationFrame(loop);setTimeout(()=>{shape.vsy=-.09;shape.wobble=1.8;},350);
