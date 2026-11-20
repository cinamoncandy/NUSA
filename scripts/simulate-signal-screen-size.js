"use strict";
/**
 * Null calibration of the signal screen test (required by docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M_V2.md section 5 before the screening span opens).
 * It feeds the real signFlipP and holm of scripts/run-signal-screen.js with synthetic mean-zero Gaussian AR(1) hourly signed-IC series (sd 0.5, equal weights 4) and prints
 *  - the single-test one-sided rejection rate at 0.02 and 0.05, and
 *  - the family-wise rate of six independent series under Holm at the level 0.02 (the pre-registered level) and 0.05.
 * It reads no database and no market value. The uniform source is a small seeded generator (mulberry32) so that thousands of repetitions run in seconds;
 * the algorithm under test is the real one.
 * Usage: node scripts/simulate-signal-screen-size.js [reps=1000] [resamples=1000] [T=720]
 */
const { signFlipP, holm } = require("./run-signal-screen.js");

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussian(u) { return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); }

function simulate({ reps, resamples, T, phi, seed }) {
  const data = mulberry32(seed); const flips = mulberry32(seed + 1);
  let single02 = 0; let single05 = 0; let fw02 = 0; let fw05 = 0;
  for (let r = 0; r < reps; r += 1) {
    const ps = [];
    for (let k = 0; k < 6; k += 1) {
      const xs = new Array(T); let prev = 0;
      for (let j = 0; j < T; j += 1) { prev = phi * prev + Math.sqrt(1 - phi * phi) * 0.5 * gaussian(data); xs[j] = prev; }
      const { p, mean } = signFlipP(xs, new Array(T).fill(4), flips, resamples);
      ps.push(mean > 0 ? p : 1); // a pass needs a positive mean
    }
    if (ps[0] < 0.02) single02 += 1; if (ps[0] < 0.05) single05 += 1;
    const adj = holm(ps); const min = Math.min(...adj);
    if (min < 0.02) fw02 += 1; if (min < 0.05) fw05 += 1;
  }
  return { phi, single02: single02 / reps, single05: single05 / reps, familywise02: fw02 / reps, familywise05: fw05 / reps };
}

if (require.main === module) {
  const reps = Number(process.argv[2] ?? 1000); const resamples = Number(process.argv[3] ?? 1000); const T = Number(process.argv[4] ?? 720);
  console.log(`null calibration: reps=${reps} resamples=${resamples} T=${T} (one-sided; nominal single 0.02 / 0.05; family-wise Holm over 6 at 0.02 / 0.05)`);
  for (const phi of [0, 0.3, 0.6, 0.8, 0.9]) console.log(JSON.stringify(simulate({ reps, resamples, T, phi, seed: 20261120 })));
}

module.exports = { simulate };
