"use strict";
/**
 * Core of the pre-registered study S3 "cheaper execution, 4 h hold" (docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md). Pure over a
 * provider; no I/O and no clock. The signal is the S2 signal with its fixed 24 h look-back.
 *
 * provider: {
 *   markets(), bookAt(market, t), lastBidBetween(market, from, to)         // as in dailyCrossSectionStudy
 *   booksBetween(market, from, to): { t, b, a }[]                         // the per-minute book snapshots with from <= t < to
 * }
 * Fill model (design v6): trade ticks exist only for the few markets of the live WebSocket, not for the ~300 order-book markets, so a
 * resting limit is judged from the minute book snapshots: a buy limit fills only if a later snapshot's best ask is strictly below the limit
 * (an ask that low means sellers traded through it), a sell limit only if a later best bid is strictly above it. The minute sampling
 * misses intra-minute crossings, so the model under-fills (conservative). Fills are all-or-nothing; partial fills are not modelled.
 */
const { minimumCount, tradeNet, compareCodes, upperMedian, cohortStats, studentTUpperP, studentTCritical, oneSidedTests } = require("./preregisteredStudyStats.js");
const { pickS2, guardProvider, constants } = require("./dailyCrossSectionStudy.js");

const { TRAIN_START, TRAIN_END, HOLD_START, HOLD_END, PRINT_AT, ALPHA, H, M } = constants;
const HOLD = 4 * H;
const CANCEL = 10 * M;
const LATENCY = 1_000;
const MAKER_BASE_BP = 5, MAKER_STRESS_BP = 10, TAKER_BASE_BP = 10, TAKER_STRESS_BP = 20;
const MAX_SPREAD_BP = 20, MIN_MARKETS = 60;

const mid = (r) => (r.a + r.b) / 2;
const spreadBp = (r) => ((r.a - r.b) / mid(r)) * 10_000;
const mean = (a) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
const range = (start, endExclusive, step) => { const out = []; for (let t = start; t < endExclusive; t += step) out.push(t); return out; };

const MIN_WINDOW_SNAPSHOTS = 5; // of the ~9 minute snapshots in a 10-minute window

/**
 * Judges one resting limit from the book snapshots in [placedAt + 1 s, placedAt + 10 min). Returns 1 (filled), 0 (not filled) or null when
 * the window has fewer than 5 snapshots (a data gap: the order cannot be judged either way).
 */
function bookFill({ side, limit, placedAt, books }) {
  const window = books.filter((x) => x.t >= placedAt + LATENCY && x.t < placedAt + CANCEL);
  if (window.length < MIN_WINDOW_SNAPSHOTS) return null;
  return window.some((x) => (side === "BUY" ? x.a < limit : x.b > limit)) ? 1 : 0;
}

/**
 * One pick under maker execution. Returns { f, r } where f is the entry fill fraction (0 = missed trade) and r the net return of the filled
 * part, or { gap: true } when a needed value does not exist. `bp` selects base or stress costs.
 */
function makerPick(provider, market, t, stress) {
  const makerBp = stress ? MAKER_STRESS_BP : MAKER_BASE_BP, takerBp = stress ? TAKER_STRESS_BP : TAKER_BASE_BP;
  const entry = provider.bookAt(market, t);
  if (entry == null) return { missing: true };
  const limitBuy = entry.b;
  const entryFill = bookFill({ side: "BUY", limit: limitBuy, placedAt: t, books: provider.booksBetween(market, t, t + CANCEL) });
  if (entryFill == null) return { gap: true };
  if (entryFill === 0) return { f: 0, r: 0 };
  const exitAt = t + HOLD;
  const exitBook = provider.bookAt(market, exitAt);
  const buyCost = limitBuy * (1 + makerBp / 10_000);
  let soldFraction = 0, sellPrice = 0;
  if (exitBook != null) {
    sellPrice = exitBook.a;
    const sold = bookFill({ side: "SELL", limit: sellPrice, placedAt: exitAt, books: provider.booksBetween(market, exitAt, exitAt + CANCEL) });
    if (sold == null) return { gap: true };
    soldFraction = sold;
  }
  const fallbackAt = exitAt + CANCEL;
  let remainder = 0;
  if (soldFraction < 1) {
    const last = provider.bookAt(market, fallbackAt);
    if (last == null) return { gap: true };
    remainder = (1 - soldFraction) * (last.b * (1 - takerBp / 10_000));
  }
  const proceeds = soldFraction * sellPrice * (1 - makerBp / 10_000) + remainder;
  return { f: entryFill, r: proceeds / buyCost - 1 };
}

/** The same pick under taker execution (entry at the ask at t, exit at the bid at t + 4 h; marked or a gap when the exit book is missing). */
function takerPick(provider, market, t, stress) {
  const bp = stress ? TAKER_STRESS_BP : TAKER_BASE_BP;
  const entry = provider.bookAt(market, t);
  if (entry == null) return { missing: true };
  const exitAt = t + HOLD, exitBook = provider.bookAt(market, exitAt);
  const bid = exitBook != null ? exitBook.b : provider.lastBidBetween(market, exitAt - H, exitAt);
  if (bid == null) return { gap: true };
  return { r: tradeNet({ askEntry: entry.a, bidExit: bid, entryBp: bp, exitBp: bp }), kind: exitBook != null ? "BOOK" : "MARKED" };
}

/** Gross (cost-free, mid to mid) return of one market over the hold: the signal's information content, independent of how it is executed. */
function grossReturn(provider, market, t) {
  const entry = provider.bookAt(market, t);
  if (entry == null) return { missing: true };
  const exitAt = t + HOLD, exitBook = provider.bookAt(market, exitAt);
  const exitPrice = exitBook != null ? mid(exitBook) : provider.lastBidBetween(market, exitAt - H, exitAt);
  if (exitPrice == null) return { gap: true };
  return { r: exitPrice / mid(entry) - 1 };
}

function eligibleMarkets(provider) {
  const times = range(TRAIN_START, TRAIN_END, HOLD);
  const need = minimumCount(times.length);
  return provider.markets().filter((market) => {
    const spreads = [];
    for (const t of times) { const b = provider.bookAt(market, t), e = provider.bookAt(market, t + HOLD); if (b != null && e != null) spreads.push(spreadBp(b)); }
    return spreads.length >= need && upperMedian(spreads) <= MAX_SPREAD_BP;
  }).sort(compareCodes);
}

function trainingCoverageOk(provider) {
  const days = range(TRAIN_START, TRAIN_END, 24 * H);
  return days.filter((t) => provider.markets().filter((m) => provider.bookAt(m, t) != null).length >= MIN_MARKETS).length >= 12;
}

function buildDays(provider, universe) {
  const decisions = range(HOLD_START, HOLD_END, HOLD).filter((t) => t + HOLD <= HOLD_END);
  const days = new Map();
  let picksTotal = 0, picksWithExit = 0, gaps = 0, coverageTimes = 0, benchEntries = 0, benchGaps = 0;
  for (const t of decisions) {
    const withBook = universe.filter((m) => provider.bookAt(m, t) != null);
    if (withBook.length >= MIN_MARKETS) coverageTimes += 1;
    const dayKey = Math.floor(t / (24 * H));
    if (!days.has(dayKey)) days.set(dayKey, { cohorts: [] });
    if (withBook.length < MIN_MARKETS) continue; // not a counted cohort (fewer than 60 eligible markets with an entry book)
    const picks = pickS2(provider, universe, t);
    const cohort = { t, selected: picks.length, maker: [], makerStress: [], taker: [], takerStress: [], fills: [], bench: [], benchStress: [], gross: [], benchGross: [] };
    for (const m of picks) {
      const mp = makerPick(provider, m, t, false), ms = makerPick(provider, m, t, true), tk = takerPick(provider, m, t, false), ts = takerPick(provider, m, t, true);
      const gr = grossReturn(provider, m, t);
      picksTotal += 1;
      cohort.gross.push(gr.gap ? -1 : gr.r ?? 0);
      if (mp.gap || tk.gap) { gaps += 1; cohort.maker.push(-1); cohort.makerStress.push(-1); cohort.taker.push(-1); cohort.takerStress.push(-1); continue; }
      if (tk.kind === "BOOK") picksWithExit += 1;
      cohort.maker.push(mp.f * mp.r); cohort.makerStress.push(ms.f * ms.r); cohort.fills.push(mp.f); // gap picks are left out of the fill rate
      cohort.taker.push(tk.r); cohort.takerStress.push(ts.r);
    }
    for (const m of withBook) {
      const b = takerPick(provider, m, t, false), bs = takerPick(provider, m, t, true), bg = grossReturn(provider, m, t);
      benchEntries += 1;
      // A benchmark market with a data gap is excluded (it could not have been bought for lack of an exit value) and counted.
      if (b.gap || bs.gap || bg.gap) { benchGaps += 1; continue; }
      cohort.bench.push(b.r); cohort.benchStress.push(bs.r); cohort.benchGross.push(bg.r);
    }
    days.get(dayKey).cohorts.push(cohort);
  }
  return { days, decisions: decisions.length, picksTotal, picksWithExit, gaps, coverageTimes, benchEntries, benchGaps };
}

function lag1to6(values) {
  const n = values.length, m = mean(values);
  const denom = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return [1, 2, 3, 4, 5, 6].map((lag) => (denom === 0 || n <= lag ? 0 : values.slice(lag).reduce((s, v, i) => s + (v - m) * (values[i] - m), 0) / denom));
}

function runMakerStudy({ provider: rawProvider, now, options = {} }) {
  if (now < PRINT_AT) return { study: "S3", status: "WAITING_DATA" };
  const provider = guardProvider(rawProvider);
  if (!trainingCoverageOk(provider)) return { study: "S3", status: "INSUFFICIENT_DATA", reasonCode: "DATA_TRAINING_COVERAGE" };
  const universe = eligibleMarkets(provider);
  const d = buildDays(provider, universe);
  const base = { study: "S3", eligibleMarkets: universe.length, scheduledDecisions: d.decisions, picks: d.picksTotal, dataGaps: d.gaps };
  if (d.coverageTimes < minimumCount(d.decisions) || (d.picksTotal > 0 && d.picksWithExit < minimumCount(d.picksTotal))) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_HOLDOUT_COVERAGE" };
  if (d.picksTotal > 0 && d.gaps > 0.05 * d.picksTotal) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_GAPS" };
  if (d.benchEntries > 0 && d.benchGaps > 0.05 * d.benchEntries) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_BENCHMARK_GAPS" };
  // One value per UTC day: counts when at least 5 of its 6 cohorts exist.
  const counted = [];
  for (const day of d.days.values()) {
    if (day.cohorts.length < 5) continue;
    const cohortValue = (c, key) => (c.selected === 0 ? 0 : c[key].reduce((s, v) => s + v, 0) / c.selected);
    const fillOf = (c) => (c.fills.length === 0 ? 0 : c.fills.reduce((a, v) => a + v, 0) / c.fills.length);
    // Per cohort: maker value minus the taker benchmark scaled by THAT cohort's fill fraction; a cohort with no pick contributes 0.
    const perCohort = (key, benchKey) => mean(day.cohorts.map((c) => (c.selected === 0 ? 0 : cohortValue(c, key) - fillOf(c) * mean(c[benchKey]))));
    const makerDay = mean(day.cohorts.map((c) => cohortValue(c, "maker"))), makerStressDay = mean(day.cohorts.map((c) => cohortValue(c, "makerStress")));
    const takerStressDay = mean(day.cohorts.map((c) => cohortValue(c, "takerStress")));
    const improvementDay = mean(day.cohorts.map((c) => (c.selected === 0 ? 0 : cohortValue(c, "maker") - cohortValue(c, "taker"))));
    const selected = day.cohorts.reduce((s, c) => s + c.selected, 0);
    const fillN = day.cohorts.reduce((s, c) => s + c.fills.length, 0);
    const fillSum = day.cohorts.reduce((s, c) => s + c.fills.reduce((a, v) => a + v, 0), 0);
    const benchDay = mean(day.cohorts.map((c) => mean(c.bench)));
    // A cohort with no pick adds 0 (never minus the benchmark): abstaining on a falling day must not create a positive gross edge.
    const grossDay = mean(day.cohorts.map((c) => (c.selected === 0 ? 0 : mean(c.gross) - mean(c.benchGross))));
    counted.push({ pickMaker: day.cohorts.flatMap((c) => c.maker), pickMakerStress: day.cohorts.flatMap((c) => c.makerStress), fillN, grossExcess: grossDay, excess: perCohort("maker", "bench"), excessStress: perCohort("makerStress", "benchStress"), improvement: improvementDay, benchDay, selected, fillSum, makerDay, makerStressDay, takerStressDay });
  }
  if (counted.length < minimumCount(d.days.size)) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_COHORTS", days: counted.length };
  if (counted.filter((x) => x.selected > 0).length < 20) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_PICK_DAYS", days: counted.length };
  const down = counted.filter((x) => x.selected > 0 && x.benchDay < 0);
  if (down.length < 8) return { ...base, status: "INSUFFICIENT_DATA", reasonCode: "DATA_DOWN_DAYS", downDays: down.length, days: counted.length };
  const excessTest = oneSidedTests(counted.map((x) => x.excess), ALPHA, options);
  const improvement = oneSidedTests(counted.map((x) => x.improvement), 0.05, options);
  const totalFillN = counted.reduce((s, x) => s + x.fillN, 0);
  const fillRate = totalFillN === 0 ? 0 : counted.reduce((s, x) => s + x.fillSum, 0) / totalFillN;
  const signalEdge = oneSidedTests(counted.map((x) => x.grossExcess), ALPHA, options);
  const downStats = cohortStats(down.map((x) => x.excess));
  const downP = downStats.sd > 0 ? studentTUpperP(downStats.t, downStats.df) : 1;
  const allPickBase = counted.flatMap((x) => x.pickMaker), allPickStress = counted.flatMap((x) => x.pickMakerStress);
  const perPickBase = mean(allPickBase), perPickStress = mean(allPickStress);
  const absStats = cohortStats(allPickBase);
  const upDays = counted.filter((x) => x.selected > 0 && x.benchDay >= 0);
  const checks = {
    signalEdgeGrossBothTests: signalEdge.pass, excessBothTests: excessTest.pass, executionImprovementBothTests: improvement.pass, fillRateAtLeast30: fillRate >= 0.30,
    stressExcessPositive: mean(counted.map((x) => x.excessStress)) > 0, absoluteBasePositive: perPickBase > 0, absoluteStressPositive: perPickStress > 0,
    downDaysPositive: downStats.mean > 0 && downP < 0.10,
  };
  const pass = Object.values(checks).every(Boolean);
  return {
    ...base, days: counted.length, status: pass ? "HOLDOUT_PASS" : "HOLDOUT_FAIL", checks, fillRate,
    meanExcessBp: excessTest.mean * 10_000, sdBp: excessTest.sd * 10_000, t: excessTest.t, tP: excessTest.tP, permP: excessTest.permP,
    grossSignalEdgeBp: signalEdge.mean * 10_000, grossSignalEdgeTP: signalEdge.tP, grossSignalEdgePermP: signalEdge.permP,
    improvementBp: improvement.mean * 10_000, improvementTP: improvement.tP, improvementPermP: improvement.permP,
    absoluteNetPerPickBp: perPickBase * 10_000, absoluteNetPerPickT: absStats.t, absoluteStressPerPickBp: perPickStress * 10_000,
    excessUpDaysBp: mean(upDays.map((x) => x.excess)) * 10_000, excessDownDaysBp: downStats.mean * 10_000, upDays: upDays.length,
    autocorrLag1to6: lag1to6(counted.map((x) => x.excess)),
    downDays: down.length, downP, minimumDetectableExcessBp: excessTest.sd > 0 ? studentTCritical(ALPHA, excessTest.df) * excessTest.sd / Math.sqrt(excessTest.n) * 10_000 : null,
  };
}

module.exports = { runMakerStudy, bookFill, makerPick, takerPick, eligibleMarkets, buildDays };
