"use strict";
/**
 * Core of the daily pre-registered studies S2 (momentum with order-book pressure) and S4 (cross-sectional reversal),
 * docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md. Pure over a book provider; no I/O and no clock. A thin runner supplies
 * the provider from the host database. Every rule below is the design file's rule.
 *
 * provider: {
 *   markets(): string[]
 *   bookAt(market, t): { t, b, a, b5, a5 } | undefined      // the last snapshot in (t - 2 min, t]
 *   lastBidBetween(market, from, to): number | undefined    // the last best bid in [from, to]
 * }
 */
const { minimumCount, tradeNet, doubledAverageRanks, compareCodes, upperMedian, cohortStats, studentTUpperP, studentTCritical, oneSidedTests } = require("./preregisteredStudyStats.js");

const M = 60_000, H = 60 * M, DAY = 24 * H;
const TRAIN_START = Date.parse("2026-10-15T00:00:00Z");
const TRAIN_END = Date.parse("2026-11-01T00:00:00Z");
const HOLD_START = Date.parse("2026-11-05T00:00:00Z");
const HOLD_END = Date.parse("2026-12-05T00:00:00Z");
const PRINT_AT = Date.parse("2026-12-05T02:00:00Z");
const ALPHA = 0.05 / 3;
const BASE_BP = 10; // taker fee 5 bp + slippage 5 bp per side
const STRESS_BP = 20;
const MAX_SPREAD_BP = 20;
const MIN_MARKETS = 60;

const validBook = (r) => r != null && Number.isFinite(r.b) && Number.isFinite(r.a) && r.b > 0 && r.a >= r.b;
/** Wraps a provider so a zero, negative, crossed or non-finite book is never a book (it would put NaN or Infinity into returns and ranks). */
function guardProvider(provider) {
  return { ...provider, bookAt: (m, t) => { const b = provider.bookAt(m, t); return validBook(b) ? b : undefined; }, lastBidBetween: (m, f, t) => { const v = provider.lastBidBetween(m, f, t); return Number.isFinite(v) && v > 0 ? v : undefined; } };
}
const mid = (r) => (r.a + r.b) / 2;
const spreadBp = (r) => ((r.a - r.b) / mid(r)) * 10_000;
const imb5 = (r) => (r.b5 + r.a5 > 0 ? (r.b5 - r.a5) / (r.b5 + r.a5) : 0);
const mean = (a) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
const range = (start, endExclusive, step) => { const out = []; for (let t = start; t < endExclusive; t += step) out.push(t); return out; };

/** Eligibility from training data only (design: 17 daily times, book + exit book for >= ceil(9n/10), upper-median spread <= 20 bp). */
function eligibleMarkets(provider) {
  const times = range(TRAIN_START, TRAIN_END, DAY);
  const need = minimumCount(times.length);
  const out = [];
  for (const market of provider.markets()) {
    const spreads = [];
    for (const t of times) {
      const book = provider.bookAt(market, t), exit = provider.bookAt(market, t + DAY);
      if (book != null && exit != null) spreads.push(spreadBp(book));
    }
    if (spreads.length >= need && upperMedian(spreads) <= MAX_SPREAD_BP) out.push(market);
  }
  return out.sort(compareCodes);
}

function trainingCoverageOk(provider) {
  const times = range(TRAIN_START, TRAIN_END, DAY);
  const days = times.filter((t) => provider.markets().filter((m) => provider.bookAt(m, t) != null).length >= MIN_MARKETS).length;
  return days >= 12;
}

/** Exit value of one market for a decision: the exit book's bid, else the last bid in [exit - 1 h, exit] (marked), else a data gap. */
function exitValue(provider, market, exitAt) {
  const book = provider.bookAt(market, exitAt);
  if (book != null) return { bid: book.b, kind: "BOOK" };
  const last = provider.lastBidBetween(market, exitAt - H, exitAt);
  return last == null ? { kind: "GAP" } : { bid: last, kind: "MARKED" };
}

function pickS2(provider, universe, t) {
  const kept = [];
  for (const market of universe) {
    const now = provider.bookAt(market, t), prev = provider.bookAt(market, t - DAY);
    if (now == null || prev == null) continue;
    const imbs = [0, 1, 2, 3, 4].map((h) => provider.bookAt(market, t - h * H)).filter((b) => b != null).map(imb5);
    if (imbs.length < 3) continue;
    const ret = Math.log(mid(now) / mid(prev)), imb = mean(imbs);
    if (ret > 0 && imb > 0) kept.push({ market, ret, imb });
  }
  const r1 = doubledAverageRanks(kept.map((k) => k.ret)), r2 = doubledAverageRanks(kept.map((k) => k.imb));
  kept.forEach((k, i) => { k.score = r1[i] + r2[i]; }); // integer: the sum of percentile ranks is this over 2(n - 1), a monotone transform of it
  return kept.sort((a, b) => b.score - a.score || compareCodes(a.market, b.market)).slice(0, 3).map((k) => k.market);
}

function pickS4(provider, universe, t) {
  const scored = [];
  for (const market of universe) {
    const now = provider.bookAt(market, t), prev = provider.bookAt(market, t - DAY);
    if (now == null || prev == null) continue;
    scored.push({ market, ret: Math.log(mid(now) / mid(prev)) });
  }
  return scored.sort((a, b) => a.ret - b.ret || compareCodes(a.market, b.market)).slice(0, 5).map((k) => k.market);
}

const PICKERS = { S2: pickS2, S4: pickS4 };

/** The holdout cohorts: one entry per scheduled decision (null where the decision had no data to pick from). */
function buildCohorts(provider, universe, study) {
  const cohorts = [];
  let marked = 0, gaps = 0, picksTotal = 0, picksWithExitBook = 0, timesWithCoverage = 0;
  const decisions = range(HOLD_START, HOLD_END, DAY).filter((t) => t + DAY <= HOLD_END);
  for (const t of decisions) {
    const exitAt = t + DAY;
    const withBook = universe.filter((m) => provider.bookAt(m, t) != null);
    if (withBook.length >= MIN_MARKETS) timesWithCoverage += 1;
    const value = (market, bp) => {
      const entry = provider.bookAt(market, t), ex = exitValue(provider, market, exitAt);
      if (ex.kind === "GAP") return { net: -1, kind: "GAP" };
      return { net: tradeNet({ askEntry: entry.a, bidExit: ex.bid, entryBp: bp, exitBp: bp }), kind: ex.kind };
    };
    const benchmark = (bp) => mean(withBook.map((m) => value(m, bp).net));
    const picks = PICKERS[study](provider, universe, t);
    for (const m of picks) {
      const v = value(m, BASE_BP);
      picksTotal += 1; if (v.kind === "BOOK") picksWithExitBook += 1; else if (v.kind === "MARKED") marked += 1; else gaps += 1;
    }
    if (withBook.length === 0) { cohorts.push(null); continue; }
    const pickNets = (bp) => picks.map((m) => value(m, bp).net);
    cohorts.push({
      t, picks: picks.length,
      baseExcess: (picks.length === 0 ? 0 : mean(pickNets(BASE_BP))) - benchmark(BASE_BP),
      stressExcess: (picks.length === 0 ? 0 : mean(pickNets(STRESS_BP))) - benchmark(STRESS_BP),
      benchmarkBase: benchmark(BASE_BP),
      pickBase: pickNets(BASE_BP), pickStress: pickNets(STRESS_BP),
    });
  }
  return { cohorts, decisions: decisions.length, marked, gaps, picksTotal, picksWithExitBook, timesWithCoverage };
}

function runDailyStudy({ provider: rawProvider, study, now, options = {} }) {
  if (now < PRINT_AT) return { status: "WAITING_DATA" };
  const provider = guardProvider(rawProvider);
  if (!PICKERS[study]) throw new Error(`unknown study ${study}`);
  if (!trainingCoverageOk(provider)) return { status: "INSUFFICIENT_DATA", reasonCode: "DATA_TRAINING_COVERAGE" };
  const universe = eligibleMarkets(provider);
  const c = buildCohorts(provider, universe, study);
  const counted = c.cohorts.filter((x) => x != null);
  const need = minimumCount(c.decisions);
  const base = { study, eligibleMarkets: universe.length, scheduledDecisions: c.decisions, cohorts: counted.length, picks: c.picksTotal, marked: c.marked, dataGaps: c.gaps };
  if (c.timesWithCoverage < minimumCount(c.decisions) || (c.picksTotal > 0 && c.picksWithExitBook < minimumCount(c.picksTotal))) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_HOLDOUT_COVERAGE" };
  if (c.picksTotal > 0 && c.gaps > 0.05 * c.picksTotal) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_GAPS" };
  if (counted.length < need) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_COHORTS" };
  const down = counted.filter((x) => x.benchmarkBase < 0);
  if (down.length < 8) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_DOWN_DAYS", downDays: down.length };
  const baseTest = oneSidedTests(counted.map((x) => x.baseExcess), ALPHA, options);
  const stressMean = mean(counted.map((x) => x.stressExcess));
  const allBase = counted.flatMap((x) => x.pickBase), allStress = counted.flatMap((x) => x.pickStress);
  const downStats = cohortStats(down.map((x) => x.baseExcess));
  const downP = downStats.sd > 0 ? studentTUpperP(downStats.t, downStats.df) : 1;
  const checks = {
    excessBothTests: baseTest.pass,
    stressExcessPositive: stressMean > 0,
    absoluteBasePositive: allBase.length > 0 && mean(allBase) > 0,
    absoluteStressPositive: allStress.length > 0 && mean(allStress) > 0,
    downDaysPositive: downStats.mean > 0 && downP < 0.10,
  };
  const pass = Object.values(checks).every(Boolean);
  const mde = baseTest.sd > 0 ? studentTCritical(ALPHA, baseTest.df) * baseTest.sd / Math.sqrt(baseTest.n) : null;
  return {
    ...base, status: pass ? "HOLDOUT_PASS" : "HOLDOUT_FAIL", checks,
    meanExcessBp: baseTest.mean * 10_000, sdBp: baseTest.sd * 10_000, t: baseTest.t, tP: baseTest.tP, permP: baseTest.permP,
    stressExcessBp: stressMean * 10_000, absoluteNetPerPickBp: mean(allBase) * 10_000, absoluteNetPerPickT: cohortStats(allBase).t, absoluteStressPerPickBp: mean(allStress) * 10_000,
    excessUpDaysBp: mean(counted.filter((x) => x.benchmarkBase >= 0).map((x) => x.baseExcess)) * 10_000, upDays: counted.length - down.length,
    downDays: down.length, downMeanExcessBp: downStats.mean * 10_000, downP,
    minimumDetectableExcessBp: mde == null ? null : mde * 10_000,
  };
}

module.exports = { guardProvider, runDailyStudy, eligibleMarkets, trainingCoverageOk, buildCohorts, pickS2, pickS4, exitValue, constants: { TRAIN_START, TRAIN_END, HOLD_START, HOLD_END, PRINT_AT, ALPHA, DAY, H, M } };
