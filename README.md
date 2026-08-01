# Flappy Pad

A gentle tap-to-fly game for children aged roughly 3–6. Installable PWA, no
dependencies, no network calls, no ads, no analytics, fully playable offline.

```
npm test      # unit tests for the game math
npm start     # serve at http://localhost:8080
```

## Design notes

The original build was a faithful Flappy Bird clone, which is close to the
opposite of what works for preschoolers: it demanded roughly 2.4 sustained taps
per second, and a single mistake ended the run. The current tuning targets a
calmer loop.

**Difficulty is expressed in seconds, not pixels.** `js/core.js` describes each
preset in human terms — how long the bird takes to fall through a gap, how many
seconds pass between pipes — and derives the pixel constants from the viewport.
The presets survive on a phone, a tablet, and a 120Hz display without retuning.
On *Easy*, the bird takes ~1.25s to fall through a gap, so roughly one tap per
second is enough.

**Failure is soft.** Three hearts per run with invincibility frames after a hit,
a ceiling that nudges instead of killing, and a terminal velocity so one missed
tap isn't fatal. Restarting is locked out for 0.9s after a run ends, because
children tap continuously and would otherwise never see the result.

**Nothing on screen needs to be read.** A pulsing hand means "tap", chevrons mean
"how fast", a row of filling stars is the score, hearts are the lives. The
numeral and the `Easy/Medium/Fast` labels are there for older children and for
the adult doing the setup.

**Sound carries the fun.** Every event has a tone, synthesised with WebAudio so
the app stays asset-free. A mute toggle sits on the start and game-over screens.

## Layout

| Path | |
|---|---|
| `js/core.js` | Pure game math — tuning, gap placement, collision. No DOM. |
| `js/app.js` | Simulation, rendering, input, audio. |
| `test/core.test.mjs` | Unit tests over `core.js`. |
| `sw.js` | Offline cache. **Bump `CACHE` on every release** or clients keep the old build. |

`window.flappyDebug` exposes read-only game state for automated play-testing.
