#!/usr/bin/env node
"use strict";
// OFFLINE RESEARCH ONLY (not host code, not a workflow, no network, reads no market data).
// F2b (adaptive bets, equal per-day IC across holds) of docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md: on SYNTHETIC one-factor data for 56 spot markets,
// estimate (a) the false-pass rate of an anytime-valid e-process on a long-only cross-sectional tilt and
// (b) how many days it needs to pass when the signal has a small true predictive correlation (IC).
// Usage: node scripts/offline-lab-f2b-adaptive-evalue.js [reps=1000] [seed=20261127]
// The signal is formed every HOLD days and predicts the next HOLD days of idiosyncratic return with correlation IC.
const REPS = Number(process.argv[2] || 1000), SEED = Number(process.argv[3] || 20261127);
const N = 56, DAYS = 365, ALPHA = 0.0125, COST = 0.0015, ANN = 365, BURN = 20;
const MKT_VOL = 0.03, IDIO_VOL = 0.035, TOP = Math.round(N / 3);
const LAMBDAS = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5];

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normal(rnd) { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); }
function t4(rnd) { let c = 0; for (let i = 0; i < 4; i++) { const z = normal(rnd); c += z * z; } return normal(rnd) / Math.sqrt(c / 4) * Math.SQRT1_2; }

// One run: each day the signal ranks markets; hold the top third (equal weight) for HOLD days; excess = holding minus basket,
// minus turnover cost. The e-process bets a fixed mixture of fractions (optionally averaged with an adaptive predictable bet) on the clipped, predictably scaled excess.
function run(rnd, icDay, costOn, HOLD, adaptive) {
  const ic = Math.min(0.99, icDay * Math.sqrt(HOLD)); // same per-day predictive power whatever the hold
  let eA = 1, ys = 0, yq = 0, ny = 0;
  const e = LAMBDAS.map(() => 1); let prevW = new Float64Array(N), passDay = null, sum = 0, sq = 0, gsum = 0, n = 0;
  const hist = [], gs = [];
  let w = new Float64Array(N), future = null;
  for (let d = 0; d < DAYS; d++) {
    if (d % HOLD === 0) { // new block: draw the next HOLD days of idiosyncratic shocks, then a signal that sees their sum with correlation ic
      future = []; const tot = new Float64Array(N);
      for (let h = 0; h < HOLD; h++) { const row = new Float64Array(N); for (let i = 0; i < N; i++) { row[i] = t4(rnd); tot[i] += row[i]; } future.push(row); }
      const sig = new Float64Array(N); for (let i = 0; i < N; i++) sig[i] = ic * tot[i] / Math.sqrt(HOLD) + Math.sqrt(1 - ic * ic) * normal(rnd);
      const order = [...Array(N).keys()].sort((a, b) => sig[b] - sig[a]); w = new Float64Array(N); for (let k = 0; k < TOP; k++) w[order[k]] = 1 / TOP;
    }
    const m = MKT_VOL * t4(rnd), idio = new Float64Array(N); const z = future[d % HOLD];
    for (let i = 0; i < N; i++) idio[i] = IDIO_VOL * z[i];
    let hold = 0, basket = 0, turn = 0;
    for (let i = 0; i < N; i++) { const r = m + idio[i]; hold += w[i] * r; basket += r / N; turn += Math.abs(w[i] - prevW[i]); }
    prevW = w;
    const gross = hold - basket, x = gross - (costOn ? COST * turn : 0);
    sum += x; sq += x * x; gsum += gross; gs.push(gross); n++;
    if (d >= BURN && passDay == null) {
      const mu = hist.reduce((a, b) => a + b, 0) / hist.length;
      const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (hist.length - 1));
      const c = 4 * sd, y = Math.max(-1, Math.min(1, x / c));
      let mix = 0; for (let k = 0; k < LAMBDAS.length; k++) { e[k] *= 1 + LAMBDAS[k] * y; mix += e[k]; }
      // aGRAPA-style predictable bet: lambda from past clipped values only, in [0, 0.5]
      const lam = ny < 5 ? 0 : Math.max(0, Math.min(0.5, (ys / ny) / Math.max(1e-6, yq / ny)));
      eA *= 1 + lam * y; ys += y; yq += y * y; ny++;
      const evalue = adaptive ? 0.5 * eA + 0.5 * (mix / LAMBDAS.length) : mix / LAMBDAS.length;
      if (evalue >= 1 / ALPHA) passDay = d + 1;
    }
    hist.push(x);
  }
  const mean = sum / n, sd = Math.sqrt((sq - n * mean * mean) / (n - 1));
  return { passDay, sharpe: mean / sd * Math.sqrt(ANN), grossSharpe: (gsum / n) / gsdOf(gs) * Math.sqrt(ANN) };
}
function gsdOf(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); }
function wilsonUpper(k, n) { const z = 1.959964, p = k / n, d = 1 + z * z / n; return (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; }
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

console.log(JSON.stringify({ params: { N, DAYS, ALPHA, COST, TOP, BURN, MKT_VOL, IDIO_VOL, LAMBDAS, REPS, SEED, model: "synthetic one-factor t4, rebalance every HOLD days, long-only top-third tilt vs equal basket", note: "synthetic only; null assumes symmetric zero-mean excess" } }));
for (const adaptive of [false, true]) for (const HOLD of [1, 5, 20]) for (const costOn of [false, true]) for (const ic of [0, 0.02, 0.04]) {
  if (!costOn && (HOLD !== 1 || ic !== 0)) continue; // the no-cost IC 0 row is the real false-pass check
  const rnd = mulberry32(SEED + Math.round(ic * 1000) + (costOn ? 7 : 0) + HOLD * 31 + (adaptive ? 101 : 0)); let p180 = 0, p365 = 0; const days = [], sh = [], gsh = [];
  for (let r = 0; r < REPS; r++) { const o = run(rnd, ic, costOn, HOLD, adaptive); sh.push(o.sharpe); gsh.push(o.grossSharpe); if (o.passDay != null) { days.push(o.passDay); if (o.passDay <= 180) p180++; p365++; } }
  console.log(JSON.stringify({ adaptive, hold: HOLD, cost: costOn, icPerDay: ic, meanNetSharpe: +(sh.reduce((a, b) => a + b, 0) / REPS).toFixed(2), meanGrossSharpe: +(gsh.reduce((a, b) => a + b, 0) / REPS).toFixed(2), pass180: p180 / REPS, pass365: p365 / REPS, pass365Upper: +wilsonUpper(p365, REPS).toFixed(4), medianDaysAmongPassing: median(days) }));
}
