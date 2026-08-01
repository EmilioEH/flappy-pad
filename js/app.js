import {
  clamp, DIFFICULTIES, difficultyById, computeTuning,
  pipeGapY, circleRectHit, circleHit,
} from './core.js';

const canvas = document.querySelector('#game');
const app = document.querySelector('#app');
const ctx = canvas.getContext('2d');

const TAU = Math.PI * 2;
const STEP = 1 / 60;          // fixed logic timestep — decoupled from refresh rate
const MAX_FRAME = 0.25;       // don't fast-forward after a tab switch
const RESTART_LOCK = 0.9;     // seconds of dead input, so kids see the result of a run
const STARS_PER_TROPHY = 10;
const START_HEARTS = 3;
const INVULN = 1.6;

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ---------------------------------------------------------------- audio --- */
// Synthesised so the app stays asset-free and fully offline. Sound is the single
// biggest source of delight at this age, so every event gets one.
const Sound = (() => {
  let ac = null;
  let muted = store.get('flappy-muted', '0') === '1';

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, { type = 'sine', vol = 0.2, slideTo = 0, delay = 0 } = {}) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  const chord = (notes, dur, opts) => notes.forEach((f, i) => tone(f, dur, { ...opts, delay: i * (opts?.spacing ?? 0.07) }));

  return {
    unlock: ensure,
    isMuted: () => muted,
    toggle() {
      muted = !muted;
      store.set('flappy-muted', muted ? '1' : '0');
      if (!muted) tone(660, 0.12, { vol: 0.16 });
      return muted;
    },
    flap()  { tone(400, 0.13, { type: 'triangle', vol: 0.16, slideTo: 720 }); },
    score() { chord([784, 1046], 0.15, { vol: 0.17 }); },
    star()  { chord([1046, 1318, 1568], 0.13, { type: 'triangle', vol: 0.13, spacing: 0.05 }); },
    hurt()  { tone(320, 0.3, { vol: 0.2, slideTo: 160 }); },
    over()  { chord([523, 415, 330], 0.32, { vol: 0.18, spacing: 0.14 }); },
    cheer() { chord([523, 659, 784, 1046, 1318], 0.24, { type: 'triangle', vol: 0.16, spacing: 0.08 }); },
    tap()   { tone(880, 0.09, { vol: 0.14 }); },
  };
})();

/* ---------------------------------------------------------------- state --- */
const view = { w: 0, h: 0, dpr: 1 };
let tuning = null;
let difficulty = difficultyById(store.get('flappy-difficulty', 'easy'));
let best = parseInt(store.get('flappy-best', '0'), 10) || 0;

const g = {
  state: 'START',        // START | PLAYING | DEAD | PAUSED
  time: 0,
  bird: { x: 0, y: 0, vy: 0, rot: 0, wing: 0, blink: 0 },
  pipes: [],
  particles: [],
  score: 0,
  trophies: 0,
  hearts: START_HEARTS,
  invuln: 0,
  deadFor: 0,
  shake: 0,
  groundOff: 0,
  landed: false,
};

function resetRun() {
  g.bird = { x: view.w * 0.26, y: view.h * 0.4, vy: 0, rot: 0, wing: 0, blink: 2 };
  g.pipes = [];
  g.particles = [];
  g.score = 0;
  g.trophies = 0;
  g.hearts = START_HEARTS;
  g.invuln = 0;
  g.deadFor = 0;
  g.shake = 0;
  g.landed = false;
}

/* --------------------------------------------------------------- layout --- */
// Buttons live here so hit-testing and drawing can never drift apart.
const layout = {
  mute: () => ({ x: view.w * 0.5, y: view.h * 0.92, r: view.h * 0.038 }),
  play: () => ({ x: view.w * 0.5, y: view.h * 0.5, r: view.h * 0.075 }),
  replay: () => ({ x: view.w * 0.5, y: view.h * 0.56, r: view.h * 0.085 }),
  home: () => ({ x: view.w * 0.5, y: view.h * 0.74, r: view.h * 0.05 }),
  levels() {
    const r = Math.min(view.h * 0.045, view.w * 0.11);
    const step = r * 2.9;
    return DIFFICULTIES.map((d, i) => ({
      d, r,
      x: view.w * 0.5 + (i - 1) * step,
      y: view.h * 0.76,
    }));
  },
};

const inCircle = (x, y, c, slack = 1.35) => {
  const dx = x - c.x, dy = y - c.y, r = c.r * slack;   // generous targets for small fingers
  return dx * dx + dy * dy <= r * r;
};

/* --------------------------------------------------------------- resize --- */
function resize() {
  const availW = window.innerWidth;
  const availH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;

  // Fill the window, but never let the playfield get wider than it is tall — that
  // keeps a landscape window from becoming an unreadable letterbox. On a portrait
  // iPad this now uses the whole screen instead of a thin 480px column.
  const h = Math.max(240, availH);
  const w = Math.max(200, Math.min(availW, h));

  const prev = { w: view.w, h: view.h };
  view.w = w;
  view.h = h;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);

  app.style.width = w + 'px';
  app.style.height = h + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * view.dpr);
  canvas.height = Math.round(h * view.dpr);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  const nextTuning = computeTuning(w, h, difficulty);

  // Rescale a run in progress instead of leaving the bird underground.
  if (prev.w > 0 && prev.h > 0 && (prev.w !== w || prev.h !== h)) {
    const sx = w / prev.w, sy = h / prev.h;
    g.bird.x = view.w * 0.26;
    g.bird.y *= sy;
    for (const p of g.pipes) { p.x *= sx; p.gapY *= sy; }
    g.particles.length = 0;
    if (g.state === 'PLAYING') g.state = 'PAUSED';
  }

  tuning = nextTuning;
  if (!g.bird.x) g.bird.x = view.w * 0.26;
}

function applyDifficulty(d) {
  difficulty = d;
  store.set('flappy-difficulty', d.id);
  tuning = computeTuning(view.w, view.h, d);
}

/* ---------------------------------------------------------------- input --- */
function flap() {
  g.bird.vy = tuning.flapV;
  g.bird.wing = 1;
  Sound.flap();
}

function startRun() {
  resetRun();
  g.state = 'PLAYING';
  flap();
}

function primaryAction(x, y) {
  Sound.unlock();

  if (g.state === 'PAUSED') { g.state = 'PLAYING'; return; }

  if (g.state === 'START') {
    if (inCircle(x, y, layout.mute())) { Sound.toggle(); return; }
    for (const b of layout.levels()) {
      if (inCircle(x, y, b)) { applyDifficulty(b.d); Sound.tap(); return; }
    }
    startRun();
    return;
  }

  if (g.state === 'PLAYING') { flap(); return; }

  if (g.state === 'DEAD') {
    // Deliberate lockout: preschoolers tap continuously and would otherwise never
    // see the result of the run they just finished.
    if (g.deadFor < RESTART_LOCK) return;
    if (inCircle(x, y, layout.mute())) { Sound.toggle(); return; }
    if (inCircle(x, y, layout.home())) { g.state = 'START'; resetRun(); Sound.tap(); return; }
    if (inCircle(x, y, layout.replay())) { startRun(); return; }
  }
}

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (view.w / r.width),
    y: (e.clientY - r.top) * (view.h / r.height),
  };
}

/* ---------------------------------------------------------------- world --- */
function spawnPipe() {
  const gapY = pipeGapY(Math.random(), view.h, tuning);
  g.pipes.push({ x: view.w + tuning.pipeW, gapY, passed: false, starTaken: false });
}

function burst(x, y, color, n, spread) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const sp = spread * (0.35 + Math.random() * 0.65);
    g.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - spread * 0.25,
      life: 0.5 + Math.random() * 0.45,
      age: 0,
      r: tuning.radius * (0.12 + Math.random() * 0.18),
      color,
    });
  }
}

function hurt() {
  if (g.invuln > 0 || g.state !== 'PLAYING') return;
  g.hearts--;
  g.shake = 0.3;
  burst(g.bird.x, g.bird.y, '#ff9db1', 16, tuning.diameter * 6);
  if (g.hearts <= 0) {
    die();
  } else {
    g.invuln = INVULN;
    g.bird.vy = tuning.flapV * 0.9;
    Sound.hurt();
  }
}

function die() {
  g.state = 'DEAD';
  g.deadFor = 0;
  g.landed = false;
  if (g.score > best) { best = g.score; store.set('flappy-best', best); }
  Sound.over();
}

function update(dt) {
  g.time += dt;
  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt);

  const b = g.bird;
  b.wing = Math.max(0, b.wing - dt * 3.2);
  b.blink = b.blink > 0 ? b.blink - dt : 2.5 + Math.random() * 2.5;

  for (const p of g.particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += tuning.gravity * 0.5 * dt; }
  g.particles = g.particles.filter(p => p.age < p.life);

  if (g.state === 'START') {
    b.y = view.h * 0.4 + Math.sin(g.time * 2.2) * tuning.diameter * 0.28;
    b.rot = Math.sin(g.time * 2.2) * 6;
    g.groundOff = (g.groundOff + tuning.speed * 0.35 * dt) % (tuning.diameter * 0.5);
    return;
  }

  if (g.state === 'PAUSED') return;

  if (g.state === 'DEAD') {
    g.deadFor += dt;
    if (!g.landed) {
      b.vy = Math.min(b.vy + tuning.gravity * dt, tuning.maxFall);
      b.y += b.vy * dt;
      b.rot = Math.min(b.rot + 220 * dt, 90);
      const floor = view.h - tuning.groundH - tuning.hitR;
      if (b.y >= floor) { b.y = floor; b.vy = 0; g.landed = true; }
    }
    return;
  }

  /* PLAYING */
  if (g.invuln > 0) g.invuln -= dt;

  b.vy = Math.min(b.vy + tuning.gravity * dt, tuning.maxFall);   // terminal velocity, so one
  b.y += b.vy * dt;                                              // missed tap isn't fatal

  // The ceiling nudges instead of killing — hitting the top was a very common
  // and very unfair way for a small child to lose a run.
  if (b.y - tuning.hitR < 0) { b.y = tuning.hitR; b.vy = Math.max(b.vy, 0); }

  const targetRot = clamp(b.vy / tuning.maxFall * 55, -22, 55);
  b.rot += (targetRot - b.rot) * Math.min(1, dt * 9);

  for (const p of g.pipes) p.x -= tuning.speed * dt;
  g.groundOff = (g.groundOff + tuning.speed * dt) % (tuning.diameter * 0.5);

  const last = g.pipes[g.pipes.length - 1];
  if (!last || last.x < view.w - tuning.spawnDist) spawnPipe();
  g.pipes = g.pipes.filter(p => p.x + tuning.pipeW > -tuning.pipeW);

  for (const p of g.pipes) {
    // Bonus star in the middle of the gap: a visible thing to aim at and a
    // reward moment that doesn't depend on reading a number.
    if (!p.starTaken && circleHit(b.x, b.y, tuning.hitR, p.x + tuning.pipeW / 2, p.gapY + tuning.gap / 2, tuning.starR)) {
      p.starTaken = true;
      burst(p.x + tuning.pipeW / 2, p.gapY + tuning.gap / 2, '#ffd54a', 12, tuning.diameter * 5);
      Sound.star();
    }

    if (!p.passed && p.x + tuning.pipeW < b.x) {
      p.passed = true;
      g.score++;
      if (g.score % STARS_PER_TROPHY === 0) {
        g.trophies++;
        burst(view.w / 2, view.h * 0.2, '#ffd54a', 28, tuning.diameter * 8);
        Sound.cheer();
      } else {
        Sound.score();
      }
    }

    if (g.invuln <= 0) {
      const bottomY = p.gapY + tuning.gap;
      if (circleRectHit(b.x, b.y, tuning.hitR, p.x, 0, tuning.pipeW, p.gapY) ||
          circleRectHit(b.x, b.y, tuning.hitR, p.x, bottomY, tuning.pipeW, view.h - bottomY - tuning.groundH)) {
        hurt();
      }
    }
  }

  if (b.y + tuning.hitR > view.h - tuning.groundH) {
    b.y = view.h - tuning.groundH - tuning.hitR;
    hurt();
  }
}

/* ----------------------------------------------------------------- draw --- */
function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function starPath(x, y, r, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function heartPath(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.75);
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.5, x - r * 0.5, y - r * 1.2, x, y - r * 0.35);
  ctx.bezierCurveTo(x + r * 0.5, y - r * 1.2, x + r * 1.5, y - r * 0.5, x, y + r * 0.75);
  ctx.closePath();
}

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, view.h);
  grad.addColorStop(0, '#5ec9f7');
  grad.addColorStop(0.6, '#9fe0fb');
  grad.addColorStop(1, '#d8f2ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, view.w, view.h);

  // Drifting clouds, sized to the screen rather than hardcoded pixels.
  const cw = view.w;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 4; i++) {
    const speed = 8 + i * 4;
    const cx = ((i * cw * 0.37 + view.w * 2 - g.time * speed) % (cw * 1.4)) - cw * 0.2;
    const cy = view.h * (0.08 + i * 0.055);
    const r = view.h * (0.022 + (i % 2) * 0.008);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.arc(cx + r * 1.1, cy - r * 0.35, r * 0.85, 0, TAU);
    ctx.arc(cx + r * 2, cy + r * 0.1, r * 0.7, 0, TAU);
    ctx.fill();
  }

  // Soft hills for depth.
  ctx.fillStyle = 'rgba(126, 204, 140, 0.45)';
  const hy = view.h - tuning.groundH;
  const hr = view.h * 0.09;
  ctx.beginPath();
  ctx.moveTo(0, hy);
  for (let x = -hr; x < view.w + hr * 2; x += hr * 1.6) {
    ctx.arc(x - (g.groundOff * 0.3), hy, hr, Math.PI, 0);
  }
  ctx.lineTo(view.w, hy);
  ctx.closePath();
  ctx.fill();
}

function drawPipes() {
  const { pipeW, gap, groundH } = tuning;
  const capH = Math.max(14, pipeW * 0.34);
  const capOver = pipeW * 0.12;
  const radius = pipeW * 0.18;

  for (const p of g.pipes) {
    const bottomY = p.gapY + gap;
    const bottomH = view.h - bottomY - groundH;

    for (const [y, h] of [[p.gapY - view.h, view.h], [bottomY, bottomH]]) {
      const grad = ctx.createLinearGradient(p.x, 0, p.x + pipeW, 0);
      grad.addColorStop(0, '#8ad14f');
      grad.addColorStop(0.35, '#a8e06b');
      grad.addColorStop(1, '#6cb437');
      ctx.fillStyle = grad;
      roundRect(p.x, y, pipeW, Math.max(0, h), radius);
      ctx.fill();
    }

    ctx.fillStyle = '#7cc63f';
    roundRect(p.x - capOver, p.gapY - capH, pipeW + capOver * 2, capH, radius);
    ctx.fill();
    roundRect(p.x - capOver, bottomY, pipeW + capOver * 2, capH, radius);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(p.x - capOver + pipeW * 0.1, p.gapY - capH + capH * 0.18, pipeW * 0.22, capH * 0.5, capH * 0.2);
    ctx.fill();
    roundRect(p.x - capOver + pipeW * 0.1, bottomY + capH * 0.18, pipeW * 0.22, capH * 0.5, capH * 0.2);
    ctx.fill();

    if (!p.starTaken) {
      const sx = p.x + pipeW / 2;
      const sy = p.gapY + gap / 2;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.sin(g.time * 2 + p.gapY) * 0.25);
      ctx.shadowColor = 'rgba(255, 200, 40, 0.8)';
      ctx.shadowBlur = tuning.starR * 0.9;
      ctx.fillStyle = '#ffd54a';
      starPath(0, 0, tuning.starR * (1 + Math.sin(g.time * 4) * 0.06));
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawGround() {
  const y = view.h - tuning.groundH;
  ctx.fillStyle = '#dfd39a';
  ctx.fillRect(0, y, view.w, tuning.groundH);
  ctx.fillStyle = '#8bcf55';
  ctx.fillRect(0, y, view.w, tuning.groundH * 0.22);
  ctx.fillStyle = '#7bbd47';
  const bladeW = tuning.diameter * 0.5;
  for (let x = -g.groundOff; x < view.w; x += bladeW) {
    ctx.beginPath();
    ctx.moveTo(x, y + tuning.groundH * 0.22);
    ctx.lineTo(x + bladeW * 0.25, y + tuning.groundH * 0.05);
    ctx.lineTo(x + bladeW * 0.5, y + tuning.groundH * 0.22);
    ctx.fill();
  }
}

function drawBird() {
  const b = g.bird;
  const R = tuning.radius;
  if (g.invuln > 0 && Math.floor(g.invuln * 12) % 2 === 0) return;   // flash while safe

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot * Math.PI / 180);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = R * 0.5;
  ctx.shadowOffsetY = R * 0.18;

  const body = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.15, 0, 0, R);
  body.addColorStop(0, '#ffe987');
  body.addColorStop(1, '#f5bd2f');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Wing actually animates now — a tap has visible feedback, not just motion.
  const lift = Math.sin(b.wing * Math.PI) * 1.1;
  ctx.save();
  ctx.translate(-R * 0.28, R * 0.1);
  ctx.rotate(-0.25 - lift * 0.9);
  ctx.fillStyle = '#eda51c';
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.62, R * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#f4831f';
  ctx.beginPath();
  ctx.moveTo(R * 0.82, -R * 0.16);
  ctx.lineTo(R * 1.5, R * 0.12);
  ctx.lineTo(R * 0.82, R * 0.42);
  ctx.closePath();
  ctx.fill();

  const blinking = b.blink < 0.12;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(R * 0.35, -R * 0.3, R * 0.34, 0, TAU);
  ctx.fill();
  if (!blinking) {
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(R * 0.46, -R * 0.3, R * 0.18, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(R * 0.52, -R * 0.37, R * 0.07, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#2b2b33';
    ctx.lineWidth = R * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(R * 0.2, -R * 0.3);
    ctx.lineTo(R * 0.55, -R * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  for (const p of g.particles) {
    const t = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = p.color;
    starPath(p.x, p.y, p.r * (0.5 + t), 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function textStyle(size, weight = 'bold') {
  ctx.font = `${weight} ${size}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

function shadowText(str, x, y, size, color = '#fff') {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetY = size * 0.06;
  ctx.fillStyle = color;
  textStyle(size);
  ctx.fillText(str, x, y);
  ctx.restore();
}

function drawHud() {
  // The game-over panel restates the score, so the live HUD would just be clutter.
  if (g.state === 'START' || g.state === 'DEAD') return;
  const pad = view.h * 0.025;

  // Hearts, so "how much trouble am I in" is readable without words or numbers.
  const hr = view.h * 0.017;
  for (let i = 0; i < START_HEARTS; i++) {
    const x = pad + hr * 1.4 + i * hr * 3;
    const y = pad + hr * 1.4;
    ctx.save();
    if (i < g.hearts) {
      ctx.fillStyle = '#ff5d73';
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = hr * 0.6;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
    }
    heartPath(x, y, hr);
    ctx.fill();
    ctx.restore();
  }

  // Numeral for the older end of the range...
  shadowText(String(g.score), view.w / 2, view.h * 0.075, view.h * 0.062);

  // ...and a filling row of stars for children who can't read it yet.
  const filled = g.score % STARS_PER_TROPHY;
  const sr = view.h * 0.011;
  const gapX = sr * 2.6;
  const startX = view.w / 2 - (STARS_PER_TROPHY - 1) * gapX / 2;
  for (let i = 0; i < STARS_PER_TROPHY; i++) {
    const on = i < (filled === 0 && g.score > 0 ? STARS_PER_TROPHY : filled);
    ctx.fillStyle = on ? '#ffd54a' : 'rgba(255,255,255,0.35)';
    starPath(startX + i * gapX, view.h * 0.125, sr);
    ctx.fill();
  }

  if (g.trophies > 0) {
    const tx = view.w - pad - view.h * 0.03;
    const ty = pad + view.h * 0.025;
    ctx.fillStyle = '#ffd54a';
    starPath(tx, ty, view.h * 0.022, 6);
    ctx.fill();
    shadowText('x' + g.trophies, tx - view.h * 0.045, ty, view.h * 0.03);
  }
}

function drawHand(x, y, size, pulse) {
  const s = size * (1 + pulse * 0.12);
  ctx.save();
  ctx.translate(x, y + pulse * size * 0.25);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.arc(0, -s * 0.55, s * (0.9 + pulse * 0.5), 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = s * 0.06;
  // Palm
  roundRect(-s * 0.45, -s * 0.15, s * 0.9, s * 1.0, s * 0.32);
  ctx.fill();
  ctx.stroke();
  // Pointing finger
  roundRect(-s * 0.16, -s * 0.95, s * 0.32, s * 0.9, s * 0.16);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCircleButton(c, color, drawIcon) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = c.r * 0.4;
  ctx.shadowOffsetY = c.r * 0.12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(c.x, c.y);
  drawIcon(c.r);
  ctx.restore();
}

function iconPlay(r) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-r * 0.28, -r * 0.45);
  ctx.lineTo(r * 0.5, 0);
  ctx.lineTo(-r * 0.28, r * 0.45);
  ctx.closePath();
  ctx.fill();
}

function iconReplay(r) {
  const R = r * 0.46;
  const a0 = -Math.PI * 0.72;
  const a1 = Math.PI * 0.72;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.19;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R, a0, a1);
  ctx.stroke();
  // Arrowhead pinned to the end of the arc and rotated onto its tangent.
  ctx.save();
  ctx.translate(Math.cos(a1) * R, Math.sin(a1) * R);
  ctx.rotate(a1 + Math.PI / 2);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(r * 0.3, 0);
  ctx.lineTo(-r * 0.12, -r * 0.22);
  ctx.lineTo(-r * 0.12, r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function iconHome(r) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.58);
  ctx.lineTo(r * 0.66, -r * 0.04);
  ctx.lineTo(-r * 0.66, -r * 0.04);
  ctx.closePath();
  ctx.fill();
  roundRect(-r * 0.44, -r * 0.08, r * 0.88, r * 0.6, r * 0.1);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(-r * 0.14, r * 0.16, r * 0.28, r * 0.36, r * 0.06);
  ctx.fill();
}

function iconSpeaker(r, muted) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, -r * 0.18);
  ctx.lineTo(-r * 0.18, -r * 0.18);
  ctx.lineTo(r * 0.08, -r * 0.48);
  ctx.lineTo(r * 0.08, r * 0.48);
  ctx.lineTo(-r * 0.18, r * 0.18);
  ctx.lineTo(-r * 0.45, r * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.11;
  ctx.lineCap = 'round';
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(r * 0.24, -r * 0.24);
    ctx.lineTo(r * 0.56, r * 0.24);
    ctx.moveTo(r * 0.56, -r * 0.24);
    ctx.lineTo(r * 0.24, r * 0.24);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(r * 0.12, 0, r * 0.28, -0.9, 0.9);
    ctx.arc(r * 0.12, 0, r * 0.5, -0.9, 0.9);
    ctx.stroke();
  }
}

function drawMuteButton() {
  const c = layout.mute();
  drawCircleButton({ ...c }, 'rgba(0,0,0,0.28)', r => iconSpeaker(r, Sound.isMuted()));
}

function drawLevelPicker() {
  for (const b of layout.levels()) {
    const active = b.d.id === difficulty.id;
    drawCircleButton(b, active ? '#ff9f45' : 'rgba(255,255,255,0.32)', r => {
      // Chevron count reads as "how fast" without needing to read a word.
      ctx.strokeStyle = active ? '#fff' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = r * 0.17;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const n = b.d.chevrons;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * r * 0.42;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.16, -r * 0.3);
        ctx.lineTo(x + r * 0.16, 0);
        ctx.lineTo(x - r * 0.16, r * 0.3);
        ctx.stroke();
      }
    });
    // Small word for the grown-up doing the setup, not for the child.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    textStyle(b.r * 0.42, '600');
    ctx.fillText(b.d.label, b.x, b.y + b.r * 1.6);
  }
}

function drawStartScreen() {
  ctx.fillStyle = 'rgba(0, 40, 70, 0.18)';
  ctx.fillRect(0, 0, view.w, view.h);
  shadowText('Flappy Pad', view.w / 2, view.h * 0.2, view.h * 0.06);
  drawHand(view.w / 2, view.h * 0.56, view.h * 0.055, (Math.sin(g.time * 3.4) + 1) / 2);
  drawLevelPicker();
  drawMuteButton();
}

function drawPauseScreen() {
  ctx.fillStyle = 'rgba(0, 40, 70, 0.4)';
  ctx.fillRect(0, 0, view.w, view.h);
  drawCircleButton(layout.play(), '#4cc06a', iconPlay);
}

function drawDeadScreen() {
  ctx.fillStyle = 'rgba(0, 30, 55, 0.45)';
  ctx.fillRect(0, 0, view.w, view.h);

  // Score as a big numeral plus stars, so it lands either way.
  shadowText(String(g.score), view.w / 2, view.h * 0.26, view.h * 0.13);
  const shown = Math.min(g.score, 10);
  const sr = view.h * 0.016;
  const gapX = sr * 2.7;
  const startX = view.w / 2 - (shown - 1) * gapX / 2;
  for (let i = 0; i < shown; i++) {
    ctx.fillStyle = '#ffd54a';
    starPath(startX + i * gapX, view.h * 0.35, sr);
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ffd54a';
  starPath(view.w / 2 - view.h * 0.035, view.h * 0.43, view.h * 0.02, 6);
  ctx.fill();
  ctx.restore();
  shadowText(String(best), view.w / 2 + view.h * 0.015, view.h * 0.43, view.h * 0.035);

  const ready = g.deadFor >= RESTART_LOCK;
  ctx.save();
  ctx.globalAlpha = ready ? 1 : 0.35;
  const c = layout.replay();
  const pulse = ready ? 1 + Math.sin(g.time * 4) * 0.04 : 1;
  drawCircleButton({ ...c, r: c.r * pulse }, '#4cc06a', iconReplay);
  drawCircleButton(layout.home(), 'rgba(255,255,255,0.3)', iconHome);
  ctx.restore();
  drawMuteButton();
}

function draw() {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);

  if (g.shake > 0) {
    const s = g.shake * tuning.diameter * 0.35;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawSky();
  drawPipes();
  drawBird();
  drawParticles();
  drawGround();
  drawHud();

  if (g.state === 'START') drawStartScreen();
  else if (g.state === 'PAUSED') drawPauseScreen();
  else if (g.state === 'DEAD') drawDeadScreen();
}

/* ----------------------------------------------------------------- loop --- */
let lastTime = 0;
let accumulator = 0;

function loop(now) {
  if (!lastTime) lastTime = now;
  // Fixed timestep: the old code advanced physics once per animation frame, so the
  // game literally ran at double speed on a 120Hz iPad.
  accumulator += Math.min((now - lastTime) / 1000, MAX_FRAME);
  lastTime = now;
  let steps = 0;
  while (accumulator >= STEP && steps++ < 8) {
    update(STEP);
    accumulator -= STEP;
  }
  draw();
  requestAnimationFrame(loop);
}

/* ----------------------------------------------------------------- init --- */
function init() {
  resize();
  resetRun();

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const { x, y } = pointerPos(e);
    primaryAction(x, y);
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
      e.preventDefault();
      primaryAction(view.w / 2, view.h / 2);
    }
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  // Auto-pause when the child switches apps, instead of letting the bird drop.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && g.state === 'PLAYING') g.state = 'PAUSED';
    lastTime = 0;
    accumulator = 0;
  });
  window.addEventListener('blur', () => { if (g.state === 'PLAYING') g.state = 'PAUSED'; });

  requestAnimationFrame(loop);
}

// Read-only handle for automated play-testing; the game never reads it back.
window.flappyDebug = {
  get state() { return g.state; },
  get score() { return g.score; },
  get hearts() { return g.hearts; },
  get birdY() { return g.bird.y; },
  get birdVy() { return g.bird.vy; },
  get simTime() { return g.time; },
  get difficulty() { return difficulty.id; },
  get view() { return { ...view }; },
  get tuning() { return { ...tuning }; },
};

init();
