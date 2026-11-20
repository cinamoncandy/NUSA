"use strict";
/**
 * Null simulation of the signal screen's bootstrap (required by docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M.md section 5 before the screening span opens).
 * It feeds the real bootstrapP of scripts/run-signal-screen.js with synthetic hourly IC series that have mean zero and an AR(1) dependence, and prints how often
 * the one-sided test rejects at 0.05 and at 0.0083 (the Holm level of the smallest p-value for K = 6). It reads no database and no market value.
 * The uniform source is a small seeded generator (mulberry32) so that thousands of repetitions run in seconds; the algorithm under test is the real one.
 * Usage: node scripts/simulate-signal-screen-size.js [reps=1000] [resamples=1000] [T=720]
 */
const { bootstrapP } = require("./run-signal-screen.js");

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussian(u) { return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); }

function simulate({ reps, resamples, T, phi, seed }) {
  const data = mulberry32(seed); const boot = mulberry32(seed + 1);
  let r05 = 0; let r0083 = 0;
  for (let r = 0; r < reps; r += 1) {
    const xs = new Array(T); let prev = 0; const sd = 0.5; // hourly IC across 5 markets has a null sd near 0.5
    for (let j = 0; j < T; j += 1) { prev = phi * prev + Math.sqrt(1 - phi * phi) * sd * gaussian(data); xs[j] = prev; }
    const ws = new Array(T).fill(4);
    const p = bootstrapP(xs, ws, boot, resamples);
    if (p < 0.05) r05 += 1; if (p < 0.0083) r0083 += 1;
  }
  return { phi, size05: r05 / reps, size0083: r0083 / reps };
}

if (require.main === module) {
  const reps = Number(process.argv[2] ?? 1000); const resamples = Number(process.argv[3] ?? 1000); const T = Number(process.argv[4] ?? 720);
  console.log(`null simulation: reps=${reps} resamples=${resamples} T=${T} (one-sided rejection rates; nominal 0.05 and 0.0083)`);
  for (const phi of [0, 0.3, 0.6, 0.8, 0.9]) console.log(JSON.stringify(simulate({ reps, resamples, T, phi, seed: 20261120 })));
}

module.exports = { simulate };
