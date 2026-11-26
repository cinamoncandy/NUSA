#!/usr/bin/env node
"use strict";
// OFFLINE RESEARCH ONLY (not host code, not a workflow, reads no market data, no network).
// F1 of docs/ALPHA_LAB_2_SMALL_FARM_AND_TRACK_R_DESIGN_2026-11-26.md.
// Estimates, on SYNTHETIC GARCH-t price paths, (a) the false-pass rate of the farm procedure on
// random exposure-matched schedules and (b) its power when a synthetic edge is injected.
// Usage: node scripts/offline-farm-f1-calibration.js [reps=1000] [boot=400] [seed=20261126]
// The historical-path secondary check (history up to 2026-11-04 only) is NOT run here.
const REPS = Number(process.argv[2] || 1000), BOOT = Number(process.argv[3] || 400), SEED = Number(process.argv[4] || 20261126);
const COST = Number(process.env.F1_COST ?? 0.0015), ONLY = process.env.F1_ONLY || "";
const T = 180, N = 48, ALPHA = 0.0125, BLOCK = 5, ANN = 365;
const VOL_D = 0.035, MAX_RT_PER_YEAR = 24;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normal(rnd) { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); }
function tdraw(rnd, df) { let chi = 0; for (let i = 0; i < df; i++) { const z = normal(rnd); chi += z * z; } return normal(rnd) / Math.sqrt(chi / df); }

// GARCH(1,1)-t daily returns, unconditional daily vol VOL_D, market drift mu per day.
function path(rnd, mu) {
  const w = (1 - 0.1 - 0.88) * VOL_D * VOL_D, r = new Float64Array(T); let v = VOL_D * VOL_D;
  const scale = Math.sqrt(2 / 4); // t4 variance 2 -> unit variance
  for (let i = 0; i < T; i++) { const e = tdraw(rnd, 4) * scale * Math.sqrt(v); r[i] = mu + e; v = w + 0.1 * e * e + 0.88 * v; }
  return r;
}
// Exposure-matched random long/flat schedule: two-state Markov chain, at most MAX_RT round trips a year.
function schedule(rnd) {
  const e = 0.2 + 0.6 * rnd(), rt = (2 + Math.floor(rnd() * (MAX_RT_PER_YEAR * T / ANN - 1))); // round trips in window
  const pIn = Math.min(1, rt / (T * (1 - e))), pOut = Math.min(1, rt / (T * e)), pos = new Uint8Array(T);
  let s = rnd() < e ? 1 : 0;
  for (let i = 0; i < T; i++) { pos[i] = s; s = s ? (rnd() < pOut ? 0 : 1) : (rnd() < pIn ? 1 : 0); }
  return pos;
}
// A rule = {pos, cost, add}. Benchmark-adjusted net daily excess (null: no timing skill):
//   x_t = pos_t*r_t - cost_t + add_t - meanPos*meanR   (cost_t is the switch cost on a position change)
function makeRule(pos, r, sharpeEdge) {
  const cost = new Float64Array(T), add = new Float64Array(T); let prev = 0;
  for (let i = 0; i < T; i++) { cost[i] = pos[i] !== prev ? COST : 0; prev = pos[i]; }
  const rule = { pos, cost, add };
  if (sharpeEdge) { // edge sized to the rule's own daily volatility: annualized Sharpe of the added drift = sharpeEdge
    const x = adjusted(rule, r, null), sd = sdOf(x); let inDays = 0; for (let i = 0; i < T; i++) inDays += pos[i];
    const shift = sharpeEdge * sd / Math.sqrt(ANN) * T / Math.max(1, inDays);
    for (let i = 0; i < T; i++) if (pos[i]) add[i] = shift;
  }
  return rule;
}
function sdOf(x) { let s = 0, q = 0; for (let i = 0; i < T; i++) { s += x[i]; q += x[i] * x[i]; } const m = s / T; return Math.sqrt(Math.max(1e-18, (q - T * m * m) / (T - 1))); }
function adjusted(rule, r, idx) { // idx null = observed order; otherwise a resampled index vector (benchmark re-applied per draw)
  const x = new Float64Array(T); let mp = 0, mr = 0;
  for (let i = 0; i < T; i++) { const j = idx ? idx[i] : i; mp += rule.pos[j]; mr += r[j]; } mp /= T; mr /= T;
  for (let i = 0; i < T; i++) { const j = idx ? idx[i] : i; x[i] = rule.pos[j] * r[j] - rule.cost[j] + rule.add[j] - mp * mr; }
  return x;
}
function tOf(x, centerMean) { let s = 0, q = 0; for (let i = 0; i < T; i++) { s += x[i]; q += x[i] * x[i]; } const m = s / T, sd = Math.sqrt(Math.max(0, (q - T * m * m) / (T - 1))); if (sd < 1e-9) return 0; /* degenerate resample: rule flat all draw */ return (m - centerMean) / (sd / Math.sqrt(T)); }
function meanOf(x) { let s = 0; for (let i = 0; i < T; i++) s += x[i]; return s / T; }
function maxT(rules, r) { let best = -Infinity; for (const rule of rules) { const t = tOf(adjusted(rule, r, null), 0); if (t > best) best = t; } return best; }
// Fixed-scale (observed sd) stationary bootstrap, avoids sparse-resample studentization blow-up;: joint day resampling across rules, benchmark re-applied per draw, centered on the observed mean.
function bootCrit(rules, r, rnd) {
  const obsX = rules.map((rule) => adjusted(rule, r, null)), obsMean = obsX.map(meanOf), obsSd = obsX.map(sdOf);
  const maxes = new Float64Array(BOOT), idx = new Int32Array(T), p = 1 / BLOCK;
  for (let b = 0; b < BOOT; b++) {
    let j = Math.floor(rnd() * T); for (let i = 0; i < T; i++) { if (rnd() < p) j = Math.floor(rnd() * T); else j = (j + 1) % T; idx[i] = j; }
    let best = -Infinity;
    for (let k = 0; k < rules.length; k++) { const t = obsSd[k] < 1e-9 ? 0 : (meanOf(adjusted(rules[k], r, idx)) - obsMean[k]) / (obsSd[k] / Math.sqrt(T)); if (t > best) best = t; }
    maxes[b] = best;
  }
  maxes.sort(); return maxes[Math.min(BOOT - 1, Math.ceil((1 - ALPHA) * BOOT) - 1)];
}
function wilsonUpper(k, n) { const z = 1.959964, p = k / n, d = 1 + z * z / n; return (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; }

function scenario(name, mu, sharpeEdge, seed) {
  if (ONLY && ONLY !== name) return null;
  const rnd = mulberry32(seed); let pass = 0, ctrlHit = 0, passAccepted = 0, critSum = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const r = path(rnd, mu), rules = [], ctrl = [];
    for (let k = 0; k < N; k++) { rules.push(makeRule(schedule(rnd), r, k === 0 ? sharpeEdge : 0)); ctrl.push(makeRule(schedule(rnd), r, 0)); }
    const crit = bootCrit(rules, r, rnd), mt = maxT(rules, r), cm = maxT(ctrl, r); critSum += crit;
    const pas = mt > crit, hit = cm > crit; if (pas) pass++; if (hit) ctrlHit++; if (pas && !hit) passAccepted++;
  }
  const row = { scenario: name, reps: REPS, passRate: pass / REPS, passUpper95: wilsonUpper(pass, REPS), controlExceedRate: ctrlHit / REPS, passAfterGate: passAccepted / REPS, meanBootCrit: critSum / REPS };
  console.log(JSON.stringify(row)); return row;
}
console.log(JSON.stringify({ params: { T, N, ALPHA, COST, BLOCK, BOOT, REPS, SEED, VOL_D, MAX_RT_PER_YEAR, model: "synthetic GARCH(1,1)-t4", F1_ONLY: ONLY, note: "synthetic paths only; historical-path check not run; fixed-scale stationary-bootstrap max-t, benchmark re-applied per draw (v2 after review)" } }));
const t0 = Date.now();
scenario("null_drift0", 0, 0, SEED);
scenario("null_drift+0.15pct_day", 0.0015, 0, SEED + 1);
for (const s of [2, 4, 6]) scenario(`edge_sharpe_${s}`, 0, s, SEED + 10 + s);
console.log(JSON.stringify({ seconds: (Date.now() - t0) / 1000 }));
