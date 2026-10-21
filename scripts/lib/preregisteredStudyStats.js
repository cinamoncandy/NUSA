"use strict";
/**
 * Pure statistics and rule helpers shared by the pre-registered studies S2-S4 (docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md).
 * No I/O, no clock, no randomness except the fixed-seed generator below. Every formula here is the one the design file states.
 */

/** Integer ceil(9n/10): the cohort minimum (27 of 30) without floating point. */
function minimumCount(n) { return Math.floor((9 * n + 9) / 10); }

/** Net return of one trade, multiplicative: bidExit(1-cExit) / (askEntry(1+cEntry)) - 1, c = (fee + slippage) / 10000 per side. */
function tradeNet({ askEntry, bidExit, entryBp, exitBp }) {
  return (bidExit * (1 - exitBp / 10_000)) / (askEntry * (1 + entryBp / 10_000)) - 1;
}

/** Ascending percentile ranks (rank - 1) / (n - 1) with average ranks for ties; 0.5 for a single value. */
function percentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array(n);
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && order[j + 1][0] === order[i][0]) j += 1;
    const avgRank = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k += 1) out[order[k][1]] = (avgRank - 1) / (n - 1);
    i = j + 1;
  }
  return out;
}

/** Bytewise-ascending comparison of two market codes (the design's tie-break). */
function compareCodes(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** Upper median (the element at floor(n/2) of the sorted values), Infinity for none: the eligibility rule's median. */
function upperMedian(values) {
  if (values.length === 0) return Infinity;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function cohortStats(values) {
  const n = values.length;
  const mean = n === 0 ? 0 : values.reduce((s, v) => s + v, 0) / n;
  let sd = n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (sd <= 1e-12 * Math.max(1, Math.abs(mean))) sd = 0; // identical values leave float noise, which must not read as a tiny non-zero sd
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  return { n, mean, sd, t, df: n - 1 };
}

// ---- Regularised incomplete beta (continued fraction, Numerical Recipes) for the Student t tail ----
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) { y += 1; ser += c[j] / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betaCf(a, b, x) {
  const FPMIN = 1e-300; let qab = a + b; let qap = a + 1; let qam = a - 1; let c = 1; let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-15) break;
  }
  return h;
}
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** One-sided p = P(T >= t) for Student t with df degrees of freedom. */
function studentTUpperP(t, df) {
  if (!(df >= 1) || !Number.isFinite(t)) return 1;
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? tail : 1 - tail;
}

/** The t value whose one-sided upper tail equals alpha (bisection): used to print the smallest mean excess that would have passed. */
function studentTCritical(alpha, df) {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 200; i += 1) { const m = (lo + hi) / 2; if (studentTUpperP(m, df) > alpha) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** mulberry32 generator, fixed 32-bit integer seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Sign-flip permutation p = (1 + #{flipped mean >= observed mean}) / (flips + 1). Statistic = mean. */
function signFlipP(values, { flips = 100_000, seed = 20261021 } = {}) {
  const n = values.length;
  if (n === 0) return 1;
  const observed = values.reduce((s, v) => s + v, 0);
  const rand = mulberry32(seed);
  let count = 0;
  for (let f = 0; f < flips; f += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += rand() < 0.5 ? -values[i] : values[i];
    if (sum >= observed) count += 1;
  }
  return (1 + count) / (flips + 1);
}

/** Both tests at one alpha. A sample sd of 0 fails. */
function oneSidedTests(values, alpha, options) {
  const s = cohortStats(values);
  if (s.n < 2 || s.sd === 0) return { ...s, tP: 1, permP: 1, pass: false };
  const tP = studentTUpperP(s.t, s.df);
  const permP = signFlipP(values, options);
  return { ...s, tP, permP, pass: s.mean > 0 && tP < alpha && permP < alpha };
}

module.exports = { minimumCount, tradeNet, percentileRanks, compareCodes, upperMedian, cohortStats, studentTUpperP, studentTCritical, mulberry32, signFlipP, oneSidedTests };
