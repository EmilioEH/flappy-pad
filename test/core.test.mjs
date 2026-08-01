import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, DIFFICULTIES, difficultyById, computeTuning,
  pipeGapY, circleRectHit, circleHit,
} from '../js/core.js';

// A representative spread: tall phone, iPad-ish, landscape phone, tiny window.
const VIEWPORTS = [[390, 844], [756, 1080], [590, 390], [280, 300], [200, 240]];

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('difficultyById falls back to the easiest preset', () => {
  assert.equal(difficultyById('fast').id, 'fast');
  assert.equal(difficultyById('nonsense').id, 'easy');
  assert.equal(difficultyById(undefined).id, 'easy');
});

test('tuning stays positive and sane on every viewport and difficulty', () => {
  for (const [w, h] of VIEWPORTS) {
    for (const d of DIFFICULTIES) {
      const t = computeTuning(w, h, d);
      for (const [key, v] of Object.entries(t)) {
        assert.ok(Number.isFinite(v), `${key} = ${v} at ${w}x${h} (${d.id})`);
        // flapV is upward and so negative by design; everything else is a magnitude.
        assert.ok(key === 'flapV' ? v < 0 : v > 0, `${key} = ${v} at ${w}x${h} (${d.id})`);
      }
      assert.ok(t.gap > t.diameter, `gap must exceed the bird at ${w}x${h} (${d.id})`);
      assert.ok(t.gap < h - t.groundH, `gap must fit the playfield at ${w}x${h} (${d.id})`);
      assert.ok(t.hitR < t.radius, 'hitbox should be forgiving');
      assert.ok(t.flapV < 0, 'a flap must move the bird upward');
      assert.ok(t.spawnDist > t.pipeW * 2, 'pipes must not overlap');
    }
  }
});

// This is the regression the old code failed: on a short viewport the gap range
// inverted and produced negative (off-screen, unpassable) pipe gaps.
test('pipe gaps always fit inside the playfield', () => {
  for (const [w, h] of VIEWPORTS) {
    for (const d of DIFFICULTIES) {
      const t = computeTuning(w, h, d);
      for (const r of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) {
        const y = pipeGapY(r, h, t);
        assert.ok(y >= 0, `gapY ${y} went above the ceiling at ${w}x${h} (${d.id}, r=${r})`);
        assert.ok(y + t.gap <= h - t.groundH + 0.001,
          `gapY ${y} + gap ${t.gap} ran into the ground at ${w}x${h} (${d.id}, r=${r})`);
      }
    }
  }
});

// Difficulty is declared in seconds; verify the derived pixel constants actually
// deliver that, which is what makes the presets meaningful.
test('fall time through a gap matches the difficulty preset', () => {
  for (const [w, h] of VIEWPORTS) {
    for (const d of DIFFICULTIES) {
      const t = computeTuning(w, h, d);
      const step = 1 / 240;
      let y = 0, v = 0, elapsed = 0;
      while (y < t.clearance && elapsed < 10) {
        v = Math.min(v + t.gravity * step, t.maxFall);
        y += v * step;
        elapsed += step;
      }
      assert.ok(Math.abs(elapsed - d.fallTime) < 0.06,
        `${d.id} at ${w}x${h}: fell in ${elapsed.toFixed(2)}s, expected ${d.fallTime}s`);
    }
  }
});

test('a single flap does not clear the whole gap', () => {
  for (const d of DIFFICULTIES) {
    const t = computeTuning(390, 844, d);
    const rise = (t.flapV * t.flapV) / (2 * t.gravity);
    assert.ok(rise > t.diameter * 0.5, `${d.id}: flap too weak to be useful`);
    assert.ok(rise < t.clearance, `${d.id}: one flap crosses the entire gap`);
  }
});

test('circleRectHit uses circle geometry, not a bounding box', () => {
  // Dead centre overlap.
  assert.ok(circleRectHit(10, 10, 5, 8, 8, 10, 10));
  // Clear miss.
  assert.ok(!circleRectHit(0, 0, 5, 20, 20, 10, 10));
  // Just outside a corner: inside the old square hitbox, outside a real circle.
  assert.ok(!circleRectHit(6, 6, 5, 10, 10, 10, 10));
  // Straight-on edge contact at the same distance does hit.
  assert.ok(circleRectHit(6, 15, 5, 10, 10, 10, 10));
});

test('circleHit detects overlapping circles', () => {
  assert.ok(circleHit(0, 0, 5, 6, 0, 2));
  assert.ok(!circleHit(0, 0, 5, 20, 0, 2));
});
