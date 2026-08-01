// Pure game math — no DOM, no canvas, no globals.
// Split out from app.js so the parts that are easy to get wrong can be unit tested.

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// JS `%` keeps the sign of the dividend, so scrolling offsets driven by an
// ever-growing clock go permanently negative once they pass zero and the
// scrolled element never comes back. Always wrap with this instead.
export const wrap = (v, m) => ((v % m) + m) % m;

// Difficulty is described in human terms rather than pixels-per-frame, so the game
// feels identical on a 60Hz phone, a 120Hz ProMotion iPad, and any screen size:
//   gapRatio  — vertical clearance in bird-diameters
//   fallTime  — seconds to fall the full clearance from a standstill
//   riseRatio — fraction of the clearance one flap wins back
//   interval  — seconds between pipes
//   crossTime — seconds a pipe takes to cross the screen
export const DIFFICULTIES = [
  { id: 'easy',   label: 'Easy',   chevrons: 1, gapRatio: 3.4, fallTime: 1.25, riseRatio: 0.30, interval: 3.2, crossTime: 4.2 },
  { id: 'medium', label: 'Medium', chevrons: 2, gapRatio: 2.8, fallTime: 1.00, riseRatio: 0.32, interval: 2.5, crossTime: 3.3 },
  { id: 'fast',   label: 'Fast',   chevrons: 3, gapRatio: 2.3, fallTime: 0.80, riseRatio: 0.34, interval: 2.0, crossTime: 2.6 },
];

export const difficultyById = id =>
  DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[0];

// Everything the simulation needs, derived from the viewport and the chosen difficulty.
// All units are logical pixels and seconds — never per-frame.
export function computeTuning(w, h, d) {
  const groundH = clamp(h * 0.09, 40, 110);
  const sky = h - groundH;

  // A chunky, easy-to-see bird. Bounded so it stays sane on very small and very large screens.
  const diameter = clamp(Math.min(h * 0.075, w * 0.17), 34, 92);

  // Never let the gap swallow the whole playfield — there has to be room to place it.
  const gap = Math.min(diameter * (d.gapRatio + 1), sky * 0.62);
  // Clearance is what the player actually flies through. If the gap got clamped on a
  // short screen, gravity scales down with it and fallTime still holds.
  const clearance = Math.max(gap - diameter, diameter * 0.5);

  const gravity = (2 * clearance) / (d.fallTime * d.fallTime);
  const flapV = -Math.sqrt(2 * gravity * clearance * d.riseRatio);
  const maxFall = gravity * d.fallTime * 0.8;

  const pipeW = clamp(w * 0.15, 34, 96);
  const speed = w / d.crossTime;
  // Keep pipes from ever overlapping, however the numbers are tuned.
  const spawnDist = Math.max(speed * d.interval, pipeW * 3);

  return {
    groundH, diameter, radius: diameter / 2,
    // Forgiving hitbox: the bird is drawn bigger than it collides, so near-misses
    // read as wins rather than as the game cheating.
    hitR: diameter * 0.36,
    gap, clearance, gravity, flapV, maxFall,
    pipeW, speed, spawnDist,
    starR: diameter * 0.28,
  };
}

// Pick the top edge of a pipe gap. Guards the case where the playfield is too short
// to hold a full gap plus margins — the old code produced negative (off-screen,
// impossible) gaps on short viewports.
export function pipeGapY(rand, h, t) {
  const margin = t.diameter * 0.6;
  const lo = margin;
  const hi = h - t.groundH - t.gap - margin;
  if (hi <= lo) return Math.max(0, (h - t.groundH - t.gap) / 2);
  return lo + rand * (hi - lo);
}

// Circle vs axis-aligned rect. The old code used the bird's radius as a box
// half-width, which made invisible square corners collide.
export function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function circleHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by, r = ar + br;
  return dx * dx + dy * dy < r * r;
}
