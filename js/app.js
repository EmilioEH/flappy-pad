const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const canvas = $('#game');
const ctx = canvas.getContext('2d');

const GRAVITY = 0.4;
const FLAP_VEL = -6;
const PIPE_W = 52;
const PIPE_GAP = 155;
const PIPE_SPEED = 2.2;
const PIPE_SPAWN_DIST = 200;
const GROUND_H = 64;
const BIRD_X = 80;
const BIRD_R = 14;

let state = 'START';
let bird, pipes, score, best, frame, groundOff;

function reset() {
  bird = { y: canvas.height * 0.4, vy: 0, rot: 0 };
  pipes = [];
  score = 0;
  frame = 0;
  groundOff = 0;
}

function tap() {
  if (state === 'START') { state = 'PLAYING'; bird.vy = FLAP_VEL; }
  else if (state === 'PLAYING') { bird.vy = FLAP_VEL; }
  else if (state === 'GAME_OVER') { reset(); state = 'START'; }
}

function spawnPipe() {
  const minGap = 80;
  const maxGap = canvas.height - GROUND_H - PIPE_GAP - 80;
  pipes.push({
    x: canvas.width,
    gapY: minGap + Math.random() * (maxGap - minGap),
    passed: false,
  });
}

function hit() {
  if (bird.y - BIRD_R < 0) return true;
  if (bird.y + BIRD_R > canvas.height - GROUND_H) return true;
  for (const p of pipes) {
    if (bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W) {
      if (bird.y - BIRD_R < p.gapY || bird.y + BIRD_R > p.gapY + PIPE_GAP) return true;
    }
  }
  return false;
}

function update() {
  if (state === 'START') {
    bird.y += Math.sin(frame * 0.05) * 0.4;
    groundOff = (groundOff + PIPE_SPEED) % 24;
    frame++;
    return;
  }
  if (state === 'PLAYING') {
    bird.vy += GRAVITY;
    bird.y += bird.vy;
    bird.rot = Math.min(Math.max(bird.vy * 3, -25), 80);
    for (const p of pipes) {
      p.x -= PIPE_SPEED;
      if (!p.passed && p.x + PIPE_W < bird.x) {
        p.passed = true;
        score++;
      }
    }
    pipes = pipes.filter(p => p.x + PIPE_W > 0);
    groundOff = (groundOff + PIPE_SPEED) % 24;
    if (!pipes.length || pipes[pipes.length - 1].x < canvas.width - PIPE_SPAWN_DIST) spawnPipe();
    if (hit()) {
      state = 'GAME_OVER';
      if (score > best) {
        best = score;
        try { localStorage.setItem('flappy-best', best); } catch (_) {}
      }
    }
  }
}

function draw() {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#4dc9f6');
  grad.addColorStop(1, '#b5dffa');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  [[60,50,18],[85,44,24],[112,50,16],[canvas.width-100,80,20],[canvas.width-70,74,26]].forEach(([x,y,r]) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  });

  for (const p of pipes) {
    const capH = 20, capW = PIPE_W + 10;
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
    ctx.fillStyle = '#5daa24';
    ctx.fillRect(p.x + 3, 0, PIPE_W - 6, Math.max(0, p.gapY - 3));
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(p.x - 5, p.gapY - capH, capW, capH);
    ctx.fillStyle = '#5daa24';
    ctx.fillRect(p.x - 2, p.gapY - capH + 3, capW - 6, capH - 6);
    ctx.strokeStyle = '#3d7a1a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, 0, PIPE_W, p.gapY);
    ctx.strokeRect(p.x - 5, p.gapY - capH, capW, capH);

    const by = p.gapY + PIPE_GAP;
    const bh = canvas.height - by - GROUND_H;
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(p.x, by, PIPE_W, bh);
    ctx.fillStyle = '#5daa24';
    ctx.fillRect(p.x + 3, by, PIPE_W - 6, Math.max(0, bh - 3));
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(p.x - 5, by, capW, capH);
    ctx.fillStyle = '#5daa24';
    ctx.fillRect(p.x - 2, by + 3, capW - 6, capH - 6);
    ctx.strokeStyle = '#3d7a1a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, by, PIPE_W, bh);
    ctx.strokeRect(p.x - 5, by, capW, capH);
  }

  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, canvas.height - GROUND_H, canvas.width, GROUND_H);
  ctx.fillStyle = '#d4c176';
  ctx.fillRect(0, canvas.height - GROUND_H, canvas.width, 3);
  ctx.strokeStyle = '#c4a97a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = -groundOff; x < canvas.width; x += 20) {
    ctx.moveTo(x, canvas.height - GROUND_H + 6);
    ctx.lineTo(x + 10, canvas.height - GROUND_H + 14);
    ctx.lineTo(x + 20, canvas.height - GROUND_H + 6);
  }
  ctx.stroke();

  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rot * Math.PI / 180);
  const grd = ctx.createRadialGradient(-2, -2, 2, 0, 0, BIRD_R);
  grd.addColorStop(0, '#fde374');
  grd.addColorStop(1, '#f5c842');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e6a817';
  ctx.beginPath(); ctx.ellipse(-4, 4, 9, 6, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e85d04';
  ctx.beginPath();
  ctx.moveTo(BIRD_R - 1, -3); ctx.lineTo(BIRD_R + 10, 3); ctx.lineTo(BIRD_R - 1, 8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(5, -4, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(7, -4, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(8, -5, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 52px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(score, canvas.width / 2, 20);
  ctx.restore();

  if (state === 'START') {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Flappy Pad', canvas.width / 2, canvas.height * 0.35);
    ctx.font = '18px -apple-system, system-ui, sans-serif';
    ctx.fillText('Tap to Start', canvas.width / 2, canvas.height * 0.42);
    ctx.restore();
  }

  if (state === 'GAME_OVER') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Game Over', canvas.width / 2, canvas.height * 0.33);
    ctx.font = '56px -apple-system, system-ui, sans-serif';
    ctx.fillText(score, canvas.width / 2, canvas.height * 0.44);
    ctx.font = '16px -apple-system, system-ui, sans-serif';
    ctx.fillText('Best: ' + best, canvas.width / 2, canvas.height * 0.52);
    ctx.font = 'bold 20px -apple-system, system-ui, sans-serif';
    ctx.fillText('Tap to Restart', canvas.width / 2, canvas.height * 0.6);
    ctx.restore();
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

function onPointer(e) {
  e.preventDefault();
  tap();
}

function resize() {
  const app = $('#app');
  const w = app.clientWidth;
  const h = app.clientHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w;
  canvas.height = h;
  if (bird) bird.x = BIRD_X;
}

document.addEventListener('DOMContentLoaded', () => {
  try { best = parseInt(localStorage.getItem('flappy-best')) || 0; } catch (_) { best = 0; }
  resize();
  reset();
  canvas.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); tap(); } });
  window.addEventListener('resize', resize);
  loop();
});
