"use strict";
/**
 * Study S5 (docs/research-ledger/PREREGISTERED_STUDY_S5_2026-10-22.md): does top-5 depth imbalance at hh:45 predict the 15-minute mid return
 * across markets, and does it beat taker costs? Every rule below is the design file's rule; a number or sentence here that differs from
 * the design is a bug. Pure function of a book provider ({ markets(), bookIn(market, fromExclusive, toInclusive) }); places no order.
 */
const { minimumCount, tradeNet, compareCodes, upperMedian, cohortStats, studentTUpperP, oneSidedTests } = require("./preregisteredStudyStats.js");

const M = 60_000;
const H = 60 * M;
const TRAIN_START = Date.parse("2026-11-22T00:00:00Z");
const TRAIN_END = Date.parse("2026-12-06T00:00:00Z");
const HOLD_START = TRAIN_END;
const HOLD_END = Date.parse("2026-12-20T00:00:00Z");
const PRINT_AT = Date.parse("2026-12-20T02:00:00Z");
const ALPHA = 0.025; // 0.05 / 2 hypotheses
const DOWN_ALPHA = 0.10;
const SEED = 20261022;
const MIN_RANKED = 60;
const MAX_SPREAD_BP = 20;
const BASE_BP = 10; // 5 fee + 5 slippage per side
const STRESS_BP = 20; // 10 fee + 10 slippage per side
const BLOCK_HOURS = 4;
const MIN_DOWN_BLOCKS = 8;
const DEPENDENCE_LIMIT = 0.3;

const hourTimes = (start, end) => { const out = []; for (let h = start; h < end; h += H) out.push(h + 45 * M); return out; };
const valid = (b) => b != null && [b.t, b.b, b.a, b.b5, b.a5].every(Number.isFinite) && b.b > 0 && b.a > 0 && b.b <= b.a && b.b5 + b.a5 > 0;
const mid = (b) => (b.a + b.b) / 2;
const imb5 = (b) => (b.b5 - b.a5) / (b.b5 + b.a5);
const mean = (a) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);

function entryBook(provider, market, t) { const b = provider.bookIn(market, t - 2 * M, t); return valid(b) ? b : undefined; }
function exitBook(provider, market, t) { const b = provider.bookIn(market, t + 13 * M, t + 15 * M); return valid(b) ? b : undefined; }

/** Eligible = valid entry AND exit book in the SAME training hour in >= minimumCount hours, upper-median entry spread <= 20 bp. */
function eligibleMarkets(provider) {
  const times = hourTimes(TRAIN_START, TRAIN_END);
  const need = minimumCount(times.length);
  const out = [];
  for (const market of provider.markets()) {
    const spreads = [];
    for (const t of times) {
      const e = entryBook(provider, market, t);
      if (e != null && exitBook(provider, market, t) != null) spreads.push(((e.a - e.b) / mid(e)) * 10_000);
    }
    if (spreads.length >= need && upperMedian(spreads) <= MAX_SPREAD_BP) out.push(market);
  }
  return out.sort(compareCodes);
}

/** Picks of one tail: high = imb5 descending, low = ascending; ties go to the LOWEST market code in both tails. */
function pickTail(ranked, tail) {
  const k = Math.floor((ranked.length + 9) / 10);
  const sorted = [...ranked].sort((x, y) => (tail === "H" ? y.imb - x.imb : x.imb - y.imb) || compareCodes(x.market, y.market));
  return sorted.slice(0, k);
}

/** One cohort (one decision hour): null when empty (fewer than 60 ranked markets, or no benchmark market with an exit book). */
function buildCohort(provider, universe, t) {
  const ranked = [];
  for (const market of universe) {
    const e = entryBook(provider, market, t);
    if (e != null) ranked.push({ market, e, imb: imb5(e), x: exitBook(provider, market, t) });
  }
  if (ranked.length < MIN_RANKED) return null;
  const bench = ranked.filter((r) => r.x != null);
  if (bench.length === 0) return null;
  const gross = (r) => mid(r.x) / mid(r.e) - 1;
  const benchmarkGross = mean(bench.map(gross));
  const out = { ranked: ranked.length, benchGaps: ranked.length - bench.length, benchmarkGross };
  for (const tail of ["H", "L"]) {
    const picks = pickTail(ranked, tail);
    const gaps = picks.filter((p) => p.x == null).length;
    const grossValues = picks.map((p) => (p.x == null ? -1 : gross(p)));
    const net = (bp) => mean(picks.map((p) => (p.x == null ? -1 : tradeNet({ askEntry: p.e.a, bidExit: p.x.b, entryBp: bp, exitBp: bp }))));
    out[tail] = { picks: picks.length, gaps, excess: mean(grossValues) - benchmarkGross, netBase: net(BASE_BP), netStress: net(STRESS_BP) };
  }
  return out;
}

/** Lag-1 autocorrelation (mean-centred, total-variance divisor); 0 when the variance is 0. */
function lag1(values) {
  const m = mean(values);
  const den = values.reduce((s, v) => s + (v - m) ** 2, 0);
  if (den === 0) return 0;
  let num = 0;
  for (let i = 1; i < values.length; i += 1) num += (values[i] - m) * (values[i - 1] - m);
  return num / den;
}

function tailSummary(tail, cohorts, blocks) {
  const excess = cohorts.map((c) => (c == null ? 0 : c[tail].excess));
  const blockValues = blocks.map((idx) => mean(idx.map((i) => excess[i])));
  const down = blocks.map((idx, b) => {
    const live = idx.map((i) => cohorts[i]).filter((c) => c != null);
    return live.length > 0 && mean(live.map((c) => c.benchmarkGross)) < 0 ? b : -1;
  }).filter((b) => b >= 0);
  const downValues = down.map((b) => blockValues[b]);
  const downStats = cohortStats(downValues);
  const downP = downStats.n >= 2 && downStats.sd > 0 ? studentTUpperP(downStats.t, downStats.df) : 1;
  const live = cohorts.filter((c) => c != null);
  const picks = live.reduce((s, c) => s + c[tail].picks, 0);
  const gaps = live.reduce((s, c) => s + c[tail].gaps, 0);
  const tests = oneSidedTests(blockValues, ALPHA, { seed: SEED });
  return {
    grossPass: tests.pass, grossMeanBp: tests.mean * 10_000, blockT: tests.t, tP: tests.tP, permP: tests.permP, blocks: blockValues.length, blockSdBp: tests.sd * 10_000,
    r1: lag1(blockValues), picks, pickGaps: gaps, pickGapBreach: gaps * 100 > picks,
    netBaseBp: mean(cohorts.map((c) => (c == null ? 0 : c[tail].netBase))) * 10_000, netStressBp: mean(cohorts.map((c) => (c == null ? 0 : c[tail].netStress))) * 10_000,
    downBlocks: down.length, downMeanBp: downStats.mean * 10_000, downP, downPass: downStats.mean > 0 && downP < DOWN_ALPHA,
  };
}

function runImbalanceStudy({ provider, now = Date.now() }) {
  if (now < PRINT_AT) return [{ study: "S5H", status: "WAITING_DATA" }, { study: "S5L", status: "WAITING_DATA" }];
  const universe = eligibleMarkets(provider);
  const times = hourTimes(HOLD_START, HOLD_END);
  const cohorts = times.map((t) => buildCohort(provider, universe, t));
  const blocks = [];
  for (let i = 0; i < times.length; i += BLOCK_HOURS) blocks.push(Array.from({ length: Math.min(BLOCK_HOURS, times.length - i) }, (_, j) => i + j));
  const nonEmpty = cohorts.filter((c) => c != null).length;
  const benchGaps = cohorts.reduce((s, c) => s + (c == null ? 0 : c.benchGaps), 0);
  const ranked = cohorts.reduce((s, c) => s + (c == null ? 0 : c.ranked), 0);
  const base = { eligibleMarkets: universe.length, cohorts: times.length, nonEmptyCohorts: nonEmpty, benchmarkGaps: benchGaps, rankedTotal: ranked };
  if (nonEmpty < minimumCount(times.length)) return ["S5H", "S5L"].map((study) => ({ study, ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_COHORTS" }));
  const benchBreach = benchGaps * 20 > ranked;
  const sums = { S5H: tailSummary("H", cohorts, blocks), S5L: tailSummary("L", cohorts, blocks) };
  if (sums.S5H.grossPass && sums.S5L.grossPass) return ["S5H", "S5L"].map((study) => ({ study, ...base, ...sums[study], status: "BOTH_TAILS_AMBIGUOUS" }));
  return ["S5H", "S5L"].map((study) => {
    const s = sums[study];
    const r = { study, ...base, ...s };
    if (s.pickGapBreach) return { ...r, status: "INSUFFICIENT_DATA", reasonCode: "DATA_GAPS" };
    if (benchBreach) return { ...r, status: "INSUFFICIENT_DATA", reasonCode: "DATA_BENCHMARK_GAPS" };
    if (!s.grossPass) return { ...r, status: "SIGNAL_NOT_FOUND" };
    if (s.downBlocks < MIN_DOWN_BLOCKS) return { ...r, status: "INSUFFICIENT_DATA", reasonCode: "DATA_DOWN_BLOCKS" };
    if (s.r1 > DEPENDENCE_LIMIT) return { ...r, status: "INCONCLUSIVE_DEPENDENCE" };
    return { ...r, status: s.netBaseBp > 0 && s.netStressBp > 0 && s.downPass ? "HOLDOUT_PASS" : "SIGNAL_EXISTS_NOT_TRADABLE" };
  });
}

module.exports = { runImbalanceStudy, eligibleMarkets, buildCohort, pickTail, lag1, constants: { TRAIN_START, TRAIN_END, HOLD_START, HOLD_END, PRINT_AT, ALPHA, SEED, M, H } };
