const canvas = document.getElementById('slimeCanvas');
const ctx = canvas.getContext('2d');
const playground = document.getElementById('playground');
const hint = document.getElementById('touchHint');

const MODES = {
  jelly:  { color: ['#96eaff', '#55c6ed'], stiffness: 30, memory: 9, damping: .965, grab: 48, spread: 4.2, bounce: 1.1 },
  sticky: { color: ['#b8efa5', '#63cd91'], stiffness: 20, memory: 5, damping: .975, grab: 34, spread: 5.8, bounce: .7 },
  mochi:  { color: ['#ffd0e1', '#ef8bac'], stiffness: 38, memory: 13, damping: .955, grab: 58, spread: 3.5, bounce: 1.4 }
};
const POINT_COUNT = 32;
const FIXED_STEP = 1 / 120;

let modeName = 'jelly';
let dpr = 1, width = 0, height = 0, previousTime = 0, accumulator = 0;
let points = [], restOffsets = [], restArea = 1;
let pointer = { active: false, id: null, x: 0, y: 0, lastX: 0, lastY: 0, speed: 0, grabbed: 0, grabOffsetX: 0, grabOffsetY: 0 };
let muted = false, audioContext = null, lastInteraction = performance.now();
let blink = 0, surprised = 0;

function baseSize() { return Math.min(width * .34, height * .29, 210); }
function centroid() {
  const sum = points.reduce((value, point) => ({ x: value.x + point.x, y: value.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
function polygonArea(vertices = points) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const next = vertices[(i + 1) % vertices.length];
    area += vertices[i].x * next.y - next.x * vertices[i].y;
  }
  return area / 2;
}
function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) => q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x) &&
    q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y);
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (abC === 0 && onSegment(a, c, b)) || (abD === 0 && onSegment(a, d, b)) ||
    (cdA === 0 && onSegment(c, a, d)) || (cdB === 0 && onSegment(c, b, d));
}
function isTwisted(vertices = points) {
  for (let i = 0; i < vertices.length; i++) {
    const nextI = (i + 1) % vertices.length;
    for (let j = i + 2; j < vertices.length; j++) {
      const nextJ = (j + 1) % vertices.length;
      if (i === nextJ) continue;
      if (segmentsIntersect(vertices[i], vertices[nextI], vertices[j], vertices[nextJ])) return true;
    }
  }
  return false;
}
function captureRestShape(updateArea = true) {
  const center = centroid();
  restOffsets = points.map(point => ({ x: point.x - center.x, y: point.y - center.y }));
  if (updateArea) restArea = Math.max(1, Math.abs(polygonArea()));
}
function reset(sound = true) {
  const r = baseSize(), cx = width / 2, cy = height * .55;
  points = Array.from({ length: POINT_COUNT }, (_, index) => {
    const angle = index / POINT_COUNT * Math.PI * 2;
    return { x: cx + Math.cos(angle) * r * 1.12, y: cy + Math.sin(angle) * r * .82, vx: 0, vy: 0 };
  });
  captureRestShape();
  pointer.active = false; surprised = 0;
  if (sound) playSound('release', .7);
}
function resize() {
  const rect = playground.getBoundingClientRect();
  const oldWidth = width, oldHeight = height;
  dpr = Math.min(devicePixelRatio || 1, 2); width = rect.width; height = rect.height;
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!points.length) reset(false);
  else if (oldWidth && oldHeight) {
    const sx = width / oldWidth, sy = height / oldHeight;
    points.forEach(point => { point.x *= sx; point.y *= sy; point.vx *= sx; point.vy *= sy; });
    captureRestShape();
  }
}

function insideSlime(x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function nearestPoint(x, y) {
  let nearest = 0, distance = Infinity;
  points.forEach((point, index) => {
    const candidate = Math.hypot(point.x - x, point.y - y);
    if (candidate < distance) { distance = candidate; nearest = index; }
  });
  return nearest;
}

playground.addEventListener('pointerdown', event => {
  if (pointer.active || !insideSlime(event.offsetX, event.offsetY)) return;
  event.preventDefault(); playground.setPointerCapture(event.pointerId);
  const grabbed = nearestPoint(event.offsetX, event.offsetY), grabbedPoint = points[grabbed];
  pointer = {
    active: true, id: event.pointerId, x: event.offsetX, y: event.offsetY,
    lastX: event.offsetX, lastY: event.offsetY, speed: 0, grabbed,
    grabOffsetX: grabbedPoint.x - event.offsetX, grabOffsetY: grabbedPoint.y - event.offsetY
  };
  surprised = 1; lastInteraction = performance.now(); hint.classList.add('hidden'); playSound('tap');
});
playground.addEventListener('pointermove', event => {
  if (!pointer.active || event.pointerId !== pointer.id) return;
  event.preventDefault(); pointer.lastX = pointer.x; pointer.lastY = pointer.y;
  pointer.x = event.offsetX; pointer.y = event.offsetY;
  pointer.speed = Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY); lastInteraction = performance.now();
});
function release(event) {
  if (!pointer.active || (event && event.pointerId !== pointer.id)) return;
  if (event) { pointer.x = event.offsetX; pointer.y = event.offsetY; }
  pointer.active = false;
  // The deformed particle arrangement becomes the gel's new material rest shape.
  // Subsequent simulation jiggles around this shape instead of restoring an ellipse.
  // Keep the material's original area: a release may change the remembered
  // silhouette, but it must not make that silhouette the new (smaller) volume.
  captureRestShape(false);
  points.forEach(point => { point.vx *= .35; point.vy *= .35; });
  surprised = pointer.speed > 8 ? .8 : 0;
  playSound('release', Math.min(1.4, .7 + pointer.speed / 45));
}
playground.addEventListener('pointerup', release);
playground.addEventListener('pointercancel', release);

function addSpring(a, b, restLength, stiffness, dt) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  const impulse = (length - restLength) * stiffness * dt / length;
  const x = dx * impulse, y = dy * impulse;
  a.vx += x; a.vy += y; b.vx -= x; b.vy -= y;
}
function preserveArea() {
  // Project the particle ring onto the constant-area constraint. Unlike the
  // pressure force above, this positional correction cannot accumulate a
  // small volume loss over many simulation steps.
  for (let iteration = 0; iteration < 2; iteration++) {
    const signedArea = polygonArea();
    const targetArea = (signedArea < 0 ? -1 : 1) * restArea;
    const gradients = points.map((point, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      return { x: (next.y - previous.y) * .5, y: (previous.x - next.x) * .5 };
    });
    const denominator = gradients.reduce((sum, gradient) =>
      sum + gradient.x * gradient.x + gradient.y * gradient.y, 0);
    if (denominator < 1e-8) return;
    const correction = (targetArea - signedArea) / denominator;
    points.forEach((point, index) => {
      point.x += gradients[index].x * correction;
      point.y += gradients[index].y * correction;
    });
  }
}
function simulate(dt) {
  const mode = MODES[modeName], center = centroid();
  const previousPositions = points.map(point => ({ x: point.x, y: point.y }));

  // Structural springs and second-neighbour springs provide surface tension.
  for (let i = 0; i < points.length; i++) {
    for (const stride of [1, 2]) {
      const next = (i + stride) % points.length;
      const ox = restOffsets[next].x - restOffsets[i].x, oy = restOffsets[next].y - restOffsets[i].y;
      addSpring(points[i], points[next], Math.hypot(ox, oy), mode.stiffness / stride, dt);
    }
  }

  // Shape-memory bonds make the gel elastic while targeting the retained shape.
  points.forEach((point, index) => {
    point.vx += (center.x + restOffsets[index].x - point.x) * mode.memory * dt;
    point.vy += (center.y + restOffsets[index].y - point.y) * mode.memory * dt;
  });

  // A simple pressure constraint keeps the blob's volume approximately constant.
  const areaError = (restArea - Math.abs(polygonArea())) / restArea;
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    let nx = next.y - previous.y, ny = previous.x - next.x;
    const length = Math.hypot(nx, ny) || 1; nx /= length; ny /= length;
    point.vx += nx * areaError * mode.stiffness * 24 * dt;
    point.vy += ny * areaError * mode.stiffness * 24 * dt;
  });

  if (pointer.active) {
    const targetX = pointer.x + pointer.grabOffsetX, targetY = pointer.y + pointer.grabOffsetY;
    points.forEach((point, index) => {
      const rawDistance = Math.abs(index - pointer.grabbed);
      const ringDistance = Math.min(rawDistance, points.length - rawDistance);
      const influence = Math.exp(-(ringDistance * ringDistance) / (2 * mode.spread * mode.spread));
      point.vx += (targetX - point.x) * mode.grab * influence * dt;
      point.vy += (targetY - point.y) * mode.grab * influence * dt;
    });
  }

  points.forEach(point => {
    point.vx *= mode.damping; point.vy *= mode.damping;
    point.x += point.vx * dt; point.y += point.vy * dt;
    const margin = 8;
    if (point.x < margin || point.x > width - margin) { point.x = Math.max(margin, Math.min(width - margin, point.x)); point.vx *= -.25; }
    if (point.y < margin || point.y > height - margin) { point.y = Math.max(margin, Math.min(height - margin, point.y)); point.vy *= -.25; }
  });

  preserveArea();

  // The outline is a material ring: its particles may stretch but must never
  // pass through one another. Roll back a step that would fold the polygon,
  // otherwise that fold can be captured as the new rest shape on release.
  if (isTwisted()) {
    points.forEach((point, index) => {
      point.x = previousPositions[index].x; point.y = previousPositions[index].y;
      point.vx *= -.08; point.vy *= -.08;
    });
  }
}

function blobPath() {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i + points.length - 1) % points.length], point = points[i];
    const mx = (previous.x + point.x) / 2, my = (previous.y + point.y) / 2;
    if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(previous.x, previous.y, mx, my);
  }
  const last = points[points.length - 1], first = points[0];
  ctx.quadraticCurveTo(last.x, last.y, (last.x + first.x) / 2, (last.y + first.y) / 2); ctx.closePath();
}
function bounds() {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
function drawFace(box) {
  const center = centroid(), rx = (box.right - box.left) / 2, ry = (box.bottom - box.top) / 2;
  const eyeGap = Math.max(18, rx * .25), eyeY = center.y - ry * .12; ctx.fillStyle = '#53657e';
  const squish = ry < rx * .55, dizzy = pointer.active && pointer.speed > 16;
  if (squish) {
    ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = '#53657e';
    [-1, 1].forEach(side => { ctx.beginPath(); ctx.moveTo(center.x + side * eyeGap - 6, eyeY); ctx.lineTo(center.x + side * eyeGap + 6, eyeY); ctx.stroke(); });
  } else if (dizzy) {
    ctx.font = `900 ${Math.max(17, ry * .15)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('×', center.x - eyeGap, eyeY + 6); ctx.fillText('×', center.x + eyeGap, eyeY + 6);
  } else {
    const eyeHeight = Math.max(7, ry * .105 * (blink ? .2 : 1));
    [-1, 1].forEach(side => { ctx.beginPath(); ctx.ellipse(center.x + side * eyeGap, eyeY, Math.max(5, rx * .035), eyeHeight, 0, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.strokeStyle = '#53657e'; ctx.lineWidth = Math.max(4, rx * .025); ctx.lineCap = 'round'; ctx.beginPath();
  if (surprised > .3) ctx.ellipse(center.x, center.y + ry * .2, Math.max(5, rx * .045), Math.max(6, ry * .07), 0, 0, Math.PI * 2);
  else { ctx.moveTo(center.x - rx * .09, center.y + ry * .15); ctx.quadraticCurveTo(center.x, center.y + ry * .26, center.x + rx * .11, center.y + ry * .13); }
  ctx.stroke();
}
function draw() {
  ctx.clearRect(0, 0, width, height); const box = bounds(), center = centroid();
  const rx = (box.right - box.left) / 2, ry = (box.bottom - box.top) / 2;
  ctx.beginPath(); ctx.ellipse(center.x, box.bottom - ry * .04, rx * .7, Math.max(9, ry * .13), 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(83,106,142,.13)'; ctx.filter = 'blur(8px)'; ctx.fill(); ctx.filter = 'none';
  blobPath();
  const colors = MODES[modeName].color;
  const gradient = ctx.createRadialGradient(box.left + rx * .62, box.top + ry * .52, 5, center.x, center.y, Math.max(rx, ry) * 1.2);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(.7, colors[1]); gradient.addColorStop(1, colors[1]); ctx.fillStyle = gradient;
  ctx.shadowColor = colors[1] + '55'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 9; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.save(); ctx.clip();
  const shine = ctx.createLinearGradient(0, box.top, 0, center.y); shine.addColorStop(0, 'rgba(255,255,255,.72)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine; ctx.fillRect(box.left, box.top, box.right - box.left, center.y - box.top);
  ctx.beginPath(); ctx.ellipse(box.left + rx * .62, box.top + ry * .54, Math.max(8, rx * .18), Math.max(5, ry * .11), -.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
  ctx.restore(); drawFace(box);
  surprised *= .97;
}
function loop(time) {
  if (!previousTime) previousTime = time;
  accumulator += Math.min(.05, (time - previousTime) / 1000); previousTime = time;
  while (accumulator >= FIXED_STEP) { simulate(FIXED_STEP); accumulator -= FIXED_STEP; }
  if (!pointer.active && performance.now() - lastInteraction > 12000 && Math.random() < .002) {
    points.forEach(point => { point.vy -= 38 * MODES[modeName].bounce; });
    blink = 1; setTimeout(() => { blink = 0; }, 350); lastInteraction = performance.now() - 7000;
  }
  draw(); requestAnimationFrame(loop);
}

function playSound(type, pitch = 1) {
  if (muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const now = audioContext.currentTime;
    const osc = audioContext.createOscillator(), gain = audioContext.createGain(), filter = audioContext.createBiquadFilter();
    osc.type = 'sine'; osc.frequency.setValueAtTime((type === 'tap' ? 210 : 310) * pitch, now); osc.frequency.exponentialRampToValueAtTime((type === 'tap' ? 130 : 180) * pitch, now + .16);
    filter.type = 'lowpass'; filter.frequency.value = 700; gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.13, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + .2);
    osc.connect(filter).connect(gain).connect(audioContext.destination); osc.start(now); osc.stop(now + .22);
  } catch (_) { /* Audio is an optional enhancement. */ }
}

document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => {
  modeName = button.dataset.mode;
  document.querySelectorAll('.mode').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', active); });
  points.forEach(point => { point.vy -= 8 * MODES[modeName].bounce; });
  playSound('release', modeName === 'sticky' ? .75 : modeName === 'mochi' ? 1.2 : 1);
}));
document.getElementById('soundButton').addEventListener('click', function () { muted = !muted; this.classList.toggle('muted', muted); this.setAttribute('aria-pressed', muted); this.setAttribute('aria-label', muted ? '音を出す' : '音を消す'); document.getElementById('soundIcon').textContent = muted ? '×' : '♪'; if (!muted) playSound('tap'); });
document.getElementById('resetButton').addEventListener('click', () => reset(true));
window.addEventListener('resize', resize); resize(); requestAnimationFrame(loop);
