"use strict";
/**
 * Pre-registered cross-market relative momentum study RULE_CROSSMARKET_MOM_60M_20261119, work order
 * WO-LEARNING-20261120-CROSSMARKET-STUDY-SCRIPT. The rules are written in docs/RESEARCH_PREREG_2026-11-19_CROSSMARKET_MOMENTUM_60M.md;
 * this file implements that document and nothing else. It reads research_closed_candles (1 m), research_candle_absence and the order-book
 * source READ-ONLY from NUSA_CLOUD_STATE_DB_PATH and prints one line:
 *   CROSSMARKET_STUDY {"status":"WAITING_DATA"|"INSUFFICIENT_DATA"|"DATA_INTEGRITY_FAIL"|"HOLDOUT_PASS"|"HOLDOUT_FAIL", ...fixed numeric fields}
 * It places no order, writes nothing; a PASS makes the rule eligible for a SHADOW test only. Before the run time it reads no candle or book VALUE
 * (WAITING_DATA counts close times only).
 *
 * Readings of the document where it leaves room (each is also stated in the work order so nobody has to guess):
 * - A fresh PRNG (splitmix64(20261119) -> xoshiro256**) starts for every resampling test; a sign flip is made when u < 0.5.
 * - Decision hours of a part are t in [from, to); a trade exits at t + H and is dropped when that is after the part end (exactly at the end is kept).
 * - "Eligible at hour t" needs: study-eligible market, complete bar at t, close at t and at t - L, usable book at t. Hence no trade is ever dropped for "no book at t".
 * - Benchmarks are averaged over the decision hours of the retained trades. Equal weight: the eligible markets that also have a usable book at the exit.
 * - Gross = mid at the exit / mid at the entry - 1 (before fees; the spread is not in it). Net = bid at the exit after fee / ask at the entry after fee.
 * - The usable book is the last sample in the window and it must itself be usable; the spread median (training hours with a usable book) is the mean of the two middle values for an even count.
 * - Stage 1 uses the study-eligible markets with a complete bar at t that have close(t - 24 h), close(t), close(t + 1 h); an hour whose ranks are constant has no IC and is excluded and counted.
 */
const crypto = require("node:crypto");
const { orderBookSource } = require("./lib/orderBookSource.js");

const M = 60_000;
const H = 60 * M;
const MARKETS = Object.freeze(["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"]); // alphabetical: the tie-break order
const STUDY_ID = "RULE_CROSSMARKET_MOM_60M_20261119";
const START = Date.parse("2026-11-21T00:00:00Z");
const VAL = Date.parse("2026-11-28T00:00:00Z");
const HOLD = Date.parse("2026-11-30T00:00:00Z");
const END = Date.parse("2026-12-10T00:00:00Z");
const EARLIEST_RUN_AFTER_END = 30 * M;
const COVERAGE_FROM = Date.parse("2026-11-20T00:00:00Z");
const FEE = 0.0005;
const STRESS_SLIP = 0.0005;
const MAX_SPREAD_BP = 20;
const MIN_COVERAGE = 0.9;
const MIN_ELIGIBLE = 3;
const MIN_TRADES = 50;
const K = 4;
const BAR = 0.05 / K;
const BLOCK = 24;
const RESAMPLES = 10_000;
const SEED = 20261119;
const PRIMARY = Object.freeze({ lookback: 24 * H, hold: H });
const DESCRIPTIVE = Object.freeze([{ lookback: 6 * H, hold: H }, { lookback: 6 * H, hold: 4 * H }, { lookback: 24 * H, hold: 4 * H }]);

// ---- random numbers: splitmix64 -> xoshiro256** ----
const MASK = (1n << 64n) - 1n;
const rotl = (x, k) => ((x << BigInt(k)) | (x >> BigInt(64 - k))) & MASK;
function splitmix64(seed) {
  let s = BigInt(seed) & MASK;
  return () => {
    s = (s + 0x9e3779b97f4a7c15n) & MASK;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  };
}
function xoshiro256ss(state) {
  const s = [...state];
  return () => {
    const result = (rotl((s[1] * 5n) & MASK, 7) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 45);
    return result;
  };
}
/** A uniform in [0, 1): the top 53 bits of one xoshiro256** output divided by 2^53. */
function makeRandom(seed = SEED) {
  const sm = splitmix64(seed);
  const next = xoshiro256ss([sm(), sm(), sm(), sm()]);
  return () => Number(next() >> 11n) / 2 ** 53;
}

// ---- statistics ----
const mean = (a) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
function sampleSd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); }
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const v of c) { y += 1; ser += v / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betaContinuedFraction(a, b, x) {
  const tiny = 1e-30; let qab = a + b; let qap = a + 1; let qam = a - 1; let c = 1; let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}
/** One-sided p of H1 "mean > 0" by Student t on the values. */
function studentOneSidedP(values) {
  const n = values.length; if (n < 2) return 1;
  const m = mean(values); const sd = sampleSd(values);
  if (sd === 0) return m > 0 ? 0 : 1;
  const t = m / (sd / Math.sqrt(n)); const df = n - 1;
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? tail : 1 - tail;
}
/** Circular block bootstrap of the mean, null imposed by centring, one-sided p = (1 + #{m* >= m}) / (B + 1). */
function blockBootstrapP(values, random = makeRandom()) {
  const n = values.length; if (n === 0) return 1;
  const m = mean(values); const centred = values.map((v) => v - m);
  let ge = 0;
  for (let b = 0; b < RESAMPLES; b += 1) {
    let sum = 0; let count = 0;
    while (count < n) {
      const start = Math.floor(random() * n);
      for (let k = 0; k < BLOCK && count < n; k += 1) { sum += centred[(start + k) % n]; count += 1; }
    }
    if (sum / n >= m) ge += 1;
  }
  return (1 + ge) / (RESAMPLES + 1);
}
/** Sign flips of whole blocks of 24 consecutive indices (a final shorter block is one block); a flip when u < 0.5. */
function blockSignFlipP(values, random = makeRandom()) {
  const n = values.length; if (n === 0) return 1;
  const m = mean(values); const blocks = Math.ceil(n / BLOCK);
  let ge = 0;
  for (let b = 0; b < RESAMPLES; b += 1) {
    let sum = 0;
    for (let k = 0; k < blocks; k += 1) {
      const sign = random() < 0.5 ? -1 : 1;
      for (let i = k * BLOCK; i < Math.min(n, (k + 1) * BLOCK); i += 1) sum += sign * values[i];
    }
    if (sum / n >= m) ge += 1;
  }
  return (1 + ge) / (RESAMPLES + 1);
}
function averageRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i; while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}
/** Spearman rank correlation with average ranks; undefined when either side is constant. */
function spearman(x, y) {
  const rx = averageRanks(x); const ry = averageRanks(y); const mx = mean(rx); const my = mean(ry);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < rx.length; i += 1) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? undefined : sxy / Math.sqrt(sxx * syy);
}

// ---- data ----
function loadMarket(db, market, now) {
  const lo = START - 25 * H; const hi = END;
  const close = new Map();
  for (const r of db.prepare("SELECT close_time_ms AS t, close AS c FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms >= ? AND close_time_ms <= ? ORDER BY close_time_ms ASC").iterate(market, M, lo, hi)) close.set(r.t, r.c);
  const absent = new Set();
  for (const r of db.prepare("SELECT first_absent_close_ms AS a, last_absent_close_ms AS b FROM research_candle_absence WHERE market = ? AND interval_ms = ? AND last_absent_close_ms >= ? AND first_absent_close_ms <= ?").iterate(market, M, lo, hi)) {
    for (let t = Math.max(r.a, lo); t <= Math.min(r.b, hi); t += M) absent.add(t);
  }
  const books = db.prepare(`SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a FROM ${orderBookSource(db)} WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms ASC`).all(market, lo - 2 * M, hi + 2 * M);
  void now;
  return { market, close, absent, books, barCache: new Map(), bookCache: new Map() };
}
/** A bar counts only if all 60 one-minute closes (t - 59 m .. t) are present or proven exchange-absent. */
function barComplete(series, t) {
  const cached = series.barCache.get(t); if (cached !== undefined) return cached;
  let ok = true;
  for (let k = 0; k < 60 && ok; k += 1) { const c = t - k * M; if (!series.close.has(c) && !series.absent.has(c)) ok = false; }
  series.barCache.set(t, ok); return ok;
}
/** The last sample in (t - 2 min, t] when it is usable (bid > 0, ask > 0, bid < ask), else undefined. */
function bookAt(series, t) {
  if (series.bookCache.has(t)) return series.bookCache.get(t);
  const b = series.books; let lo = 0; let hi = b.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid].t > t) hi = mid; else lo = mid + 1; }
  const r = lo > 0 ? b[lo - 1] : undefined;
  const usable = r !== undefined && r.t > t - 2 * M && r.b > 0 && r.a > 0 && r.b < r.a ? r : undefined;
  series.bookCache.set(t, usable); return usable;
}
const spreadBp = (r) => ((r.a - r.b) / ((r.a + r.b) / 2)) * 10_000;
const medianOf = (v) => { if (v.length === 0) return Infinity; const s = [...v].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 === 1 ? s[h] : (s[h - 1] + s[h]) / 2; };

function isStudyEligible(series) {
  const hours = (VAL - START) / H; let good = 0; const spreads = [];
  for (let t = START; t < VAL; t += H) {
    const book = bookAt(series, t);
    if (book) spreads.push(spreadBp(book)); // the median is over the training hours that have a usable book
    if (book && barComplete(series, t)) good += 1;
  }
  return good >= MIN_COVERAGE * hours && medianOf(spreads) <= MAX_SPREAD_BP;
}
const eligibleAt = (series, t, lookback) => barComplete(series, t) && series.close.has(t) && series.close.has(t - lookback) && bookAt(series, t) !== undefined;

/** Trades of one cell in the part [from, to): a decision at every full hour (non-overlapping for hold = 1 h; the 4 h descriptive cells overlap). */
function cellTrades(eligible, cell, from, to) {
  const trades = []; const drops = { noBookAtExit: 0, exitAfterPartEnd: 0 }; let skippedHours = 0;
  for (let t = from; t < to; t += H) {
    const pool = eligible.filter((s) => eligibleAt(s, t, cell.lookback));
    if (pool.length < MIN_ELIGIBLE) { skippedHours += 1; continue; }
    const scored = pool.map((s) => ({ s, r: s.close.get(t) / s.close.get(t - cell.lookback) - 1 }))
      .sort((x, y) => (y.r - x.r) || (x.s.market < y.s.market ? -1 : x.s.market > y.s.market ? 1 : 0));
    const top = scored[0].s;
    if (t + cell.hold > to) { drops.exitAfterPartEnd += 1; continue; }
    const exitOf = (s) => bookAt(s, t + cell.hold);
    if (!exitOf(top)) { drops.noBookAtExit += 1; continue; }
    const net = (s, stress) => { const e = bookAt(s, t); const x = exitOf(s); const slip = stress ? STRESS_SLIP : 0; const fee = stress ? 2 * FEE : FEE; return (x.b * (1 - slip) * (1 - fee)) / (e.a * (1 + slip) * (1 + fee)) - 1; };
    const gross = (s) => { const e = bookAt(s, t); const x = exitOf(s); return (x.a + x.b) / (e.a + e.b) - 1; };
    const withExit = pool.filter((s) => exitOf(s) !== undefined);
    const btc = pool.find((s) => s.market === "KRW-BTC");
    trades.push({
      t, market: top.market, net: net(top, false), stress: net(top, true), gross: gross(top),
      ew: mean(withExit.map((s) => net(s, false))), ewStress: mean(withExit.map((s) => net(s, true))),
      btc: btc !== undefined && exitOf(btc) !== undefined ? net(btc, false) : undefined,
    });
  }
  return { trades, drops, skippedHours };
}

function summarize(result) {
  const { trades } = result; const bp = (x) => Math.round(x * 1e6) / 100;
  const byMarket = {}; const share = {};
  for (const m of MARKETS) { const v = trades.filter((r) => r.market === m); share[m] = trades.length === 0 ? 0 : Math.round((10_000 * v.length) / trades.length) / 10_000; byMarket[m] = v.length === 0 ? null : bp(mean(v.map((r) => r.net))); }
  const btc = trades.filter((r) => r.btc !== undefined);
  return {
    trades: trades.length, meanNetBp: bp(mean(trades.map((r) => r.net))), meanStressBp: bp(mean(trades.map((r) => r.stress))), meanGrossBp: bp(mean(trades.map((r) => r.gross))),
    winPct: trades.length === 0 ? 0 : Math.round((10_000 * trades.filter((r) => r.net > 0).length) / trades.length) / 100,
    equalWeightNetBp: bp(mean(trades.map((r) => r.ew))), btcReferenceNetBp: bp(mean(btc.map((r) => r.btc))), btcReferenceHours: btc.length,
    skippedHours: result.skippedHours, dropNoBookAtEntry: 0, dropNoBookAtExit: result.drops.noBookAtExit, dropExitAfterPartEnd: result.drops.exitAfterPartEnd,
    shareByMarket: share, meanNetBpByMarket: byMarket,
  };
}

/** Stage 1: hourly Spearman rank-IC of the 24 h return against the next-hour return, over the study-eligible markets, on [from, to - 1 h]. */
function stageOne(eligible, from, to) {
  const ics = []; let undefinedHours = 0; let skippedHours = 0;
  for (let t = from; t + H <= to; t += H) {
    const pool = eligible.filter((s) => barComplete(s, t) && s.close.has(t - 24 * H) && s.close.has(t) && s.close.has(t + H));
    if (pool.length < MIN_ELIGIBLE) { skippedHours += 1; continue; }
    const ic = spearman(pool.map((s) => s.close.get(t) / s.close.get(t - 24 * H) - 1), pool.map((s) => s.close.get(t + H) / s.close.get(t) - 1));
    if (ic === undefined) undefinedHours += 1; else ics.push(ic);
  }
  return { ics, undefinedHours, skippedHours };
}

/** Counts only (no value is read): hours per market from 2026-11-20T00:00Z that hold a close or an absence proof. */
function coverageCounts(db, now) {
  const to = Math.min(now, END); const out = {};
  for (const market of MARKETS) {
    let rows = 0; for (const _ of db.prepare("SELECT close_time_ms FROM research_closed_candles WHERE market = ? AND interval_ms = ? AND close_time_ms > ? AND close_time_ms <= ?").iterate(market, M, COVERAGE_FROM, to)) rows += 1;
    out[market] = rows;
  }
  return { coverageMinutes: out };
}

function runStudy({ db, now = Date.now() }) {
  if (now < END + EARLIEST_RUN_AFTER_END) return { status: "WAITING_DATA", daysCollected: Math.max(0, Math.floor((Math.min(now, END) - START) / (24 * H))), ...coverageCounts(db, now) };
  const futureCandles = Number(db.prepare("SELECT COUNT(*) AS n FROM research_closed_candles WHERE close_time_ms > ?").get(now + 5_000).n);
  const futureBooks = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${orderBookSource(db)} WHERE captured_at_ms > ?`).get(now + 5_000).n);
  if (futureCandles > 0 || futureBooks > 0) return { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" };
  const all = MARKETS.map((m) => loadMarket(db, m, now));
  const eligible = all.filter(isStudyEligible);
  if (eligible.length < MIN_ELIGIBLE) return { status: "INSUFFICIENT_DATA", markets: MARKETS.length, eligible: eligible.length, holdoutTrades: 0 };
  const primary = cellTrades(eligible, PRIMARY, HOLD, END);
  if (primary.trades.length < MIN_TRADES) return { status: "INSUFFICIENT_DATA", markets: MARKETS.length, eligible: eligible.length, holdoutTrades: primary.trades.length };
  const stage = stageOne(eligible, HOLD, END);
  const nets = primary.trades.map((r) => r.net);
  const paired = primary.trades.map((r) => r.net - r.ew);
  const stageOneMean = mean(stage.ics);
  const stageOneP = blockBootstrapP(stage.ics);
  const tP = studentOneSidedP(nets); const bootP = blockBootstrapP(nets); const pairedP = blockSignFlipP(paired);
  const p3 = (x) => Number(x.toPrecision(3));
  const stageOnePass = stage.ics.length > 0 && stageOneMean > 0 && stageOneP < BAR;
  const summary = summarize(primary);
  const rawNet = mean(nets); const rawStress = mean(primary.trades.map((r) => r.stress));
  const pairedMean = mean(paired);
  const pass = stageOnePass && summary.trades >= MIN_TRADES && rawNet > 0 && rawStress > 0 && tP < BAR && bootP < BAR && pairedMean > 0 && pairedP < BAR;
  const hash = crypto.createHash("sha256"); let datasetRows = 0; let firstAt = Infinity; let lastAt = -Infinity;
  for (const s of eligible) {
    hash.update(`${s.market}\n`);
    for (const [t, c] of s.close) { hash.update(`c,${t},${c}\n`); datasetRows += 1; firstAt = Math.min(firstAt, t); lastAt = Math.max(lastAt, t); }
    for (const t of [...s.absent].sort((a, b) => a - b)) hash.update(`a,${t}\n`);
    for (const r of s.books) { if (r.t > START - 25 * H && r.t <= END) { hash.update(`b,${r.t},${r.b},${r.a}\n`); datasetRows += 1; } }
  }
  const validation = summarize(cellTrades(eligible, PRIMARY, VAL, HOLD));
  return {
    status: pass ? "HOLDOUT_PASS" : "HOLDOUT_FAIL", markets: MARKETS.length, eligible: eligible.length, eligibleMarkets: eligible.map((s) => s.market),
    datasetFingerprint: hash.digest("hex"), datasetRows, datasetFirstAt: firstAt, datasetLastAt: lastAt,
    stageOne: { hours: stage.ics.length, undefinedHours: stage.undefinedHours, skippedHours: stage.skippedHours, meanIc: Math.round(stageOneMean * 1e5) / 1e5, p: p3(stageOneP), pass: stageOnePass },
    primary: { ...summary, studentP: p3(tP), bootstrapP: p3(bootP), pairedMeanBp: Math.round(pairedMean * 1e6) / 100, pairedP: p3(pairedP) },
    validation: { trades: validation.trades, meanNetBp: validation.meanNetBp, equalWeightNetBp: validation.equalWeightNetBp },
    descriptive: DESCRIPTIVE.map((cell) => ({ lookbackHours: cell.lookback / H, holdHours: cell.hold / H, ...summarize(cellTrades(eligible, cell, HOLD, END)) })),
    bar: BAR, k: K,
  };
}

module.exports = {
  runStudy, cellTrades, stageOne, spearman, averageRanks, studentOneSidedP, blockBootstrapP, blockSignFlipP, makeRandom, splitmix64, xoshiro256ss,
  incompleteBeta, barComplete, bookAt, isStudyEligible, loadMarket, MARKETS, STUDY_ID, START, VAL, HOLD, END, K, BAR, SEED, PRIMARY, DESCRIPTIVE,
};

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { console.log("CROSSMARKET_STUDY", JSON.stringify({ ...runStudy({ db }), studyId: STUDY_ID })); } finally { db.close(); }
  } catch { console.error("CROSSMARKET_STUDY_FAILED_CLOSED"); process.exitCode = 1; }
}
