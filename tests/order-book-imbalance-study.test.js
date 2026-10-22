"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runImbalanceStudy, eligibleMarkets, buildCohort, pickTail, lag1, constants } = require("../scripts/lib/orderBookImbalanceStudy.js");
const { runS5 } = require("../scripts/run-s5-study.js");

const { TRAIN_START, TRAIN_END, HOLD_START, HOLD_END, PRINT_AT, M, H } = constants;
const NOW = PRINT_AT + H;
const codes = Array.from({ length: 70 }, (_, i) => `KRW-M${String(i).padStart(2, "0")}`);

// A provider whose books come from a function (market, t) -> {b, a, b5, a5}; bookIn returns the latest "sample" at the window end.
function provider(bookFn, markets = codes) {
  return { markets: () => markets, bookIn: (market, from, to) => { const r = bookFn(market, to, from); return r == null ? undefined : { t: to, ...r }; }, hashRows: () => ({ sha256: "x", rows: 0 }) };
}
const flat = (extra = {}) => (market, to) => ({ b: 100, a: 100.1, b5: 1, a5: 1, ...extra });

test("before the print time both hypotheses report WAITING_DATA", () => {
  const out = runImbalanceStudy({ provider: provider(flat()), now: PRINT_AT - 1 });
  assert.deepEqual(out.map((r) => [r.study, r.status]), [["S5H", "WAITING_DATA"], ["S5L", "WAITING_DATA"]]);
});

test("a market with a thin training span is not eligible; a wide spread is not eligible", () => {
  const wide = (market, to) => ({ b: 100, a: market === "KRW-M00" ? 101 : 100.1, b5: 1, a5: 1 });
  const elig = eligibleMarkets(provider(wide));
  assert.ok(!elig.includes("KRW-M00") && elig.includes("KRW-M01"));
  const gone = provider((m, to) => (m === "KRW-M01" && to > TRAIN_START + 3 * 24 * H ? undefined : { b: 100, a: 100.1, b5: 1, a5: 1 }));
  assert.ok(!eligibleMarkets(gone).includes("KRW-M01"));
});

test("a book with zero size or a crossed book is not a book (no look-back to an older valid one)", () => {
  const bad = (m, to) => (m === "KRW-M02" ? { b: 100, a: 100.1, b5: 0, a5: 0 } : { b: 100, a: 100.1, b5: 1, a5: 1 });
  assert.ok(!eligibleMarkets(provider(bad)).includes("KRW-M02"));
  const crossed = (m, to) => (m === "KRW-M03" ? { b: 101, a: 100, b5: 1, a5: 1 } : { b: 100, a: 100.1, b5: 1, a5: 1 });
  assert.ok(!eligibleMarkets(provider(crossed)).includes("KRW-M03"));
});

test("ranks by imbalance, ceil(n/10) picks, ties go to the lowest market code in both tails", () => {
  const ranked = codes.slice(0, 61).map((market, i) => ({ market, imb: i < 20 ? 0.5 : i / 100 }));
  const high = pickTail(ranked, "H").map((p) => p.market);
  const low = pickTail(ranked, "L").map((p) => p.market);
  assert.equal(high.length, 7); // floor((61 + 9) / 10)
  assert.equal(low.length, 7);
  assert.equal(high[0], "KRW-M60"); // the highest imbalance
  assert.equal(low[0], "KRW-M20"); // the lowest imbalance is 0.20 (index 20); the 20 markets at 0.5 tie and lose to it
  assert.equal(pickTail([{ market: "KRW-B", imb: 1 }, { market: "KRW-A", imb: 1 }], "H")[0].market, "KRW-A");
  assert.equal(pickTail([{ market: "KRW-B", imb: 1 }, { market: "KRW-A", imb: 1 }], "L")[0].market, "KRW-A");
});

test("fewer than 60 ranked markets makes the cohort empty", () => {
  const p = provider(flat(), codes.slice(0, 59));
  assert.equal(buildCohort(p, codes.slice(0, 59), HOLD_START + 45 * M), null);
});

test("a pick without an exit book is a -100% gap and is counted; a benchmark market without an exit book is excluded", () => {
  const t = HOLD_START + 45 * M;
  const p = { markets: () => codes, bookIn: (m, from, to) => {
    const exit = to > t + 5 * M;
    if (exit && (m === "KRW-M69" || m === "KRW-M00")) return undefined;
    const i = Number(m.slice(5));
    return { t: to, b: 100, a: 100.1, b5: 1 + i / 100, a5: 1 };
  } };
  const c = buildCohort(p, codes, t);
  assert.equal(c.ranked, 70);
  assert.equal(c.benchGaps, 2);
  assert.equal(c.H.picks, 7);
  assert.equal(c.H.gaps, 1); // KRW-M69 has the highest imbalance and no exit book
  assert.ok(c.H.netBase < -0.1 && c.H.excess < -0.1);
});

test("no signal at all: verdict SIGNAL_NOT_FOUND for both hypotheses; the sd = 0 case fails the tests", () => {
  const out = runImbalanceStudy({ provider: provider(flat()), now: NOW });
  assert.deepEqual(out.map((r) => r.status), ["SIGNAL_NOT_FOUND", "SIGNAL_NOT_FOUND"]);
  assert.equal(out[0].blocks, 84);
  assert.equal(out[0].nonEmptyCohorts, 336);
});

test("an all-empty holdout is INSUFFICIENT_DATA (303 of 336 non-empty cohorts needed)", () => {
  const out = runImbalanceStudy({ provider: provider((m, to) => (to > HOLD_START ? undefined : { b: 100, a: 100.1, b5: 1, a5: 1 })), now: NOW });
  assert.deepEqual(out.map((r) => [r.status, r.reasonCode]), [["INSUFFICIENT_DATA", "DATA_COHORTS"], ["INSUFFICIENT_DATA", "DATA_COHORTS"]]);
});

test("lag-1 autocorrelation is mean-centred and 0 for a constant series", () => {
  assert.equal(lag1([1, 1, 1, 1]), 0);
  assert.ok(lag1([1, 2, 3, 4, 5, 6]) > 0.3);
  assert.ok(lag1([1, -1, 1, -1, 1, -1]) < 0);
});

test("the runner refuses to run while the design is not frozen and reports WAITING_DATA before the print time", () => {
  const db = { prepare: () => ({ get: () => ({ n: 0 }) }) };
  assert.throws(() => runS5({ db, now: NOW, frozen: () => { throw new Error("DESIGN_NOT_FROZEN"); } }), /DESIGN_NOT_FROZEN/);
  assert.deepEqual(runS5({ db, now: PRINT_AT - 1, frozen: () => ({}) }).map((r) => r.status), ["WAITING_DATA", "WAITING_DATA"]);
  assert.doesNotThrow(() => runS5({ db, now: PRINT_AT - 1 })); // the real S5 freeze check passes on this branch
});

// Planted effect: the top-imbalance markets (index >= 63) rise by 60 bp, optionally also the bottom ones (index < 7); a benchmark drift of
// alternating sign per 4-hour block keeps some blocks down; deterministic noise keeps the block values non-constant and un-autocorrelated.
function planted({ both = false }) {
  const noise = (h) => { const x = Math.sin(h * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
  return provider((market, to) => {
    const i = Number(market.slice(5));
    const isExit = (to % H) < 30 * M;
    const base = { b: 100, a: 100.05, b5: 1 + i / 100, a5: 1 };
    if (!isExit || to <= HOLD_START) return base;
    const h = Math.floor((to - 15 * M - HOLD_START) / H);
    const drift = (Math.floor(h / 4) % 2 === 0 ? -0.0006 : 0.0006) + (noise(h) - 0.5) * 0.002;
    const eff = (i >= 63 || (both && i < 7)) ? 0.006 + (noise(h + 999) - 0.5) * 0.004 : 0;
    const p = 100 * (1 + drift + eff);
    return { b: p, a: p + 0.05, b5: base.b5, a5: base.a5 };
  });
}

test("a planted tradable high-imbalance effect passes S5H and not S5L", () => {
  const out = runImbalanceStudy({ provider: planted({}), now: NOW });
  assert.equal(out[0].status, "HOLDOUT_PASS");
  assert.equal(out[1].status, "SIGNAL_NOT_FOUND");
  assert.ok(out[0].netBaseBp > 0 && out[0].netStressBp > 0 && out[0].downBlocks >= 8);
});

test("both tails working is BOTH_TAILS_AMBIGUOUS, never a pass", () => {
  const out = runImbalanceStudy({ provider: planted({ both: true }), now: NOW });
  assert.deepEqual(out.map((r) => r.status), ["BOTH_TAILS_AMBIGUOUS", "BOTH_TAILS_AMBIGUOUS"]);
});

// ---- window-exact provider over explicit samples, and verdict branches ----
function sampleProvider(samples, markets = codes) {
  return { markets: () => markets, bookIn: (market, from, to) => { const r = samples.filter((x) => x.market === market && x.t > from && x.t <= to).sort((a, b) => a.t - b.t).pop(); return r; }, hashRows: () => ({ sha256: "x", rows: 0 }) };
}

test("bookIn windows are open at the start and closed at the end, and the latest sample wins", () => {
  const t = HOLD_START + 45 * M;
  const samples = [{ market: "KRW-M00", t: t - 2 * M, b: 99, a: 99.1, b5: 1, a5: 1 }, { market: "KRW-M00", t: t - M, b: 100, a: 100.1, b5: 1, a5: 1 }];
  const p = sampleProvider(samples);
  const c = buildCohort(p, ["KRW-M00"], t);
  assert.equal(c, null); // one market is below the 60-market minimum, but the window selection is exercised in the next assertion
  assert.equal(p.bookIn("KRW-M00", t - 2 * M, t).b, 100); // the sample exactly at t - 2 min is excluded, the later one wins
  assert.equal(p.bookIn("KRW-M00", t - M, t), undefined); // a sample exactly at the window start is excluded
});

function withExit(fn) {
  // entry books flat; exit books decided by fn(market, hourIndex) -> undefined | {b, a}
  return provider((market, to, from) => {
    const isExit = (to % H) < 30 * M;
    const i = Number(market.slice(5));
    const base = { b: 100, a: 100.05, b5: 1 + i / 100, a5: 1 };
    if (!isExit || to <= HOLD_START) return base;
    const h = Math.floor((to - 15 * M - HOLD_START) / H);
    const x = fn(market, h);
    return x === undefined ? undefined : { ...x, b5: base.b5, a5: base.a5 };
  });
}

test("too many pick gaps (above 1%) is INSUFFICIENT_DATA DATA_GAPS", () => {
  const out = runImbalanceStudy({ provider: withExit((m) => (m === "KRW-M69" ? undefined : { b: 100, a: 100.05 })), now: NOW });
  assert.deepEqual(out.map((r) => [r.status, r.reasonCode]), [["INSUFFICIENT_DATA", "DATA_GAPS"], ["SIGNAL_NOT_FOUND", undefined]]);
});

test("benchmark gaps above 5% of ranked markets is INSUFFICIENT_DATA DATA_BENCHMARK_GAPS", () => {
  const out = runImbalanceStudy({ provider: withExit((m) => ((i) => (i >= 10 && i < 63 && i % 5 < 2 ? undefined : { b: 100, a: 100.05 }))(Number(m.slice(5)))), now: NOW });
  assert.ok(out.every((r) => r.status === "INSUFFICIENT_DATA"));
  assert.ok(out.some((r) => r.reasonCode === "DATA_BENCHMARK_GAPS"));
});

test("a gross pass with fewer than 8 down blocks is INSUFFICIENT_DATA DATA_DOWN_BLOCKS", () => {
  const noise = (h) => { const x = Math.sin(h * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
  const out = runImbalanceStudy({ provider: withExit((m, h) => { const i = Number(m.slice(5)); const p = 100 * (1 + 0.003 + (i >= 63 ? 0.006 + (noise(h) - 0.5) * 0.004 : 0)); return { b: p, a: p + 0.05 }; }), now: NOW });
  assert.equal(out[0].status, "INSUFFICIENT_DATA");
  assert.equal(out[0].reasonCode, "DATA_DOWN_BLOCKS");
  assert.equal(out[0].downBlocks, 0);
});

test("a gross pass whose block values are positively autocorrelated is INCONCLUSIVE_DEPENDENCE", () => {
  // The effect size trends slowly with time, so neighbouring block values are strongly correlated; benchmark alternates so down blocks exist.
  const out = runImbalanceStudy({ provider: withExit((m, h) => { const i = Number(m.slice(5)); const drift = Math.floor(h / 4) % 2 === 0 ? -0.0006 : 0.0006; const p = 100 * (1 + drift + (i >= 63 ? 0.004 + (h / 336) * 0.01 : 0)); return { b: p, a: p + 0.05 }; }), now: NOW });
  assert.equal(out[0].status, "INCONCLUSIVE_DEPENDENCE");
  assert.ok(out[0].r1 > 0.3);
});

test("a cohort whose benchmark set is empty is an empty cohort", () => {
  const t = HOLD_START + 45 * M;
  const p = { markets: () => codes, bookIn: (m, from, to) => (to > t + 5 * M ? undefined : { t: to, b: 100, a: 100.1, b5: 1.1, a5: 1 }) };
  assert.equal(buildCohort(p, codes, t), null);
});

test("the runner reports DATA_INTEGRITY_FAIL before WAITING_DATA when a row is stamped in the future", () => {
  const db = { prepare: () => ({ get: () => ({ n: 1 }) }) };
  const out = runS5({ db, now: PRINT_AT - 1, frozen: () => ({}) });
  assert.deepEqual(out.map((r) => [r.status, r.reasonCode]), [["DATA_INTEGRITY_FAIL", "DATA_FUTURE"], ["DATA_INTEGRITY_FAIL", "DATA_FUTURE"]]);
});

test("makeDbProvider.bookIn on real SQLite: an invalid latest sample is no book (no look-back); the dataset hash can be limited to markets", () => {
  const { DatabaseSync } = require("node:sqlite");
  const { makeDbProvider } = require("../scripts/run-preregistered-studies.js");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_orderbook_samples (market TEXT, captured_at_ms INTEGER, best_bid REAL, best_ask REAL, bid_size_5 REAL, ask_size_5 REAL, total_bid_size REAL, total_ask_size REAL, PRIMARY KEY (market, captured_at_ms))");
  const ins = db.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, ?, ?, ?, ?, 0, 0)");
  const t = HOLD_START + 45 * M;
  ins.run("KRW-A", t - 90_000, 100, 100.1, 1, 1); // older valid sample
  ins.run("KRW-A", t - 30_000, 101, 100, 1, 1); // newer but crossed (invalid)
  ins.run("KRW-B", t - 30_000, 100, 100.1, 1, 1);
  const p = makeDbProvider(db, { from: t - H, to: t + H });
  assert.equal(p.bookIn("KRW-A", t - 2 * M, t), undefined);
  assert.equal(p.bookIn("KRW-B", t - 2 * M, t).b, 100);
  ins.run("KRW-C", t - 20_000, 100, 100.1, 1, 1);
  assert.equal(p.bookIn("KRW-C", t - 2 * M, t).b, 100);
  const all = p.hashRows(); // the crossed KRW-A book was never accepted, so KRW-B and KRW-C were consumed
  const onlyB = p.hashRows(new Set(["KRW-B"]));
  assert.equal(all.rows, 2);
  assert.equal(onlyB.rows, 1);
  assert.notEqual(onlyB.sha256, all.sha256);
  assert.equal(p.hashRows().sha256, all.sha256); // no filter: unchanged and repeatable
});
