"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { makeRandom } = require("../scripts/run-crossmarket-study.js");
const mining = require("../scripts/run-history-mining.js");

const H = 3_600_000;
const M = 60_000;
const { CUT } = mining;
const DAY = 24 * H;

function normal(random) { const u = Math.max(random(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()); }

/** Hourly closes (close_time_ms on the hour; the miner only uses those) for the given markets. phi < 0 plants mean reversion, 0 is a random walk. */
function makeDb({ markets, phi = {}, seed = 1, from = CUT - 60 * DAY, to = CUT, extraAfterCut = false }) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL, volume REAL, PRIMARY KEY(market, interval_ms, close_time_ms))");
  const insert = db.prepare("INSERT INTO research_closed_candles(market, interval_ms, close_time_ms, close, volume) VALUES (?,?,?,?,?)");
  markets.forEach((market, i) => {
    const random = makeRandom(seed * 100 + i);
    let price = 1000; let last = 0;
    for (let t = from; t < to + (extraAfterCut ? 5 * DAY : 0); t += H) {
      const r = (phi[market] ?? 0) * last + 0.005 * normal(random);
      price *= 1 + r; last = r;
      insert.run(market, M, t, price, 1);
    }
  });
  return db;
}
const ALL = ["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"];
const windows = { discoveryStart: CUT - 50 * DAY, discoveryEnd: CUT - 20 * DAY, holdbackStart: CUT - 15 * DAY, holdbackEnd: CUT - 1 * H };
const mr = { "KRW-BTC": -0.5, "KRW-DOGE": -0.5, "KRW-ETH": -0.5, "KRW-SOL": -0.5, "KRW-XRP": -0.5 };

test("the grid is fixed: 128 rules, none duplicating a pre-registered signal, with a printed fingerprint", () => {
  assert.equal(mining.RULES.length, 128);
  assert.equal(new Set(mining.RULES.map((r) => r.id)).size, 128);
  for (const r of mining.RULES) assert.doesNotMatch(r.id, /^(RET6|RET24|RET72|VOL24|SURGE|RANGE)_/, r.id);
  assert.match(mining.GRID_FINGERPRINT, /^[0-9a-f]{64}$/);
});

test("windows are checked: order, 96 hour purge, full hours and the CUT", () => {
  const ok = { ...windows };
  assert.doesNotThrow(() => mining.checkWindows(ok));
  assert.throws(() => mining.checkWindows({ ...ok, holdbackStart: ok.discoveryEnd + 95 * H }), /purge/);
  assert.doesNotThrow(() => mining.checkWindows({ ...ok, holdbackStart: ok.discoveryEnd + 96 * H }));
  assert.throws(() => mining.checkWindows({ ...ok, discoveryStart: ok.discoveryEnd }), /ordered|purge/);
  assert.throws(() => mining.checkWindows({ ...ok, holdbackEnd: CUT + H }), /2026-11-20/);
});

test("planted mean reversion is found in discovery and passes the single look; blind markets only", () => {
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  assert.equal(found.status, "SHORTLIST");
  assert.ok(found.shortlist.length >= 1 && found.shortlist.length <= 5);
  assert.ok(found.shortlist[0].n >= mining.MIN_TRADES);
  assert.ok(found.shortlist[0].meanNet > 0);
  assert.equal(found.trials, 128);
  const freeze = mining.freezeRecord(found, "2026-11-20T00:00:00.000Z");
  assert.equal(freeze.lookedAt, null);
  assert.equal(freeze.fingerprint, mining.fingerprintOf(freeze));
  const seen = [];
  const spy = { prepare: (sql) => { const s = db.prepare(sql); return { iterate: (...args) => { seen.push(args); return s.iterate(...args); } }; } };
  const result = mining.look({ db: spy, freeze, resamples: 2000 });
  assert.equal(result.status, "LOOK_PASS");
  assert.ok(result.candidates.some((c) => c.pass && c.meanNet > 0));
  assert.ok(seen.length > 0 && seen.every((args) => args[0] !== "KRW-XRP"), "XRP never enters the hold-back");
});

test("the shortlist never holds two rules whose trades overlap by more than half", () => {
  assert.equal(mining.overlap([{ market: "A", t: 1 }, { market: "A", t: 2 }], [{ market: "A", t: 1 }, { market: "A", t: 2 }, { market: "A", t: 3 }]), 1);
  assert.equal(mining.overlap([{ market: "A", t: 1 }], [{ market: "B", t: 1 }]), 0);
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  // nested thresholds of one signal, side and hold (Q80 contains Q90) overlap heavily: only one of them may be shortlisted
  const keys = found.shortlist.map((s) => s.id.replace(/_Q\d+_/, "_"));
  assert.equal(new Set(keys).size, keys.length, keys.join(","));
});

test("a random walk gives a shortlist (the search always finds a winner) but the look does not pass it", () => {
  let passes = 0; let shortlisted = 0;
  for (const seed of [11, 12, 13, 14]) {
    const db = makeDb({ markets: ALL, phi: {}, seed });
    const found = mining.discover({ db, windows });
    assert.ok(found.status === "SHORTLIST" || found.status === "NO_SHORTLIST");
    if (found.status !== "SHORTLIST") continue;
    shortlisted += 1;
    const result = mining.look({ db, freeze: mining.freezeRecord(found, "x"), resamples: 2000 });
    if (result.status === "LOOK_PASS") passes += 1;
  }
  assert.ok(shortlisted >= 3, `the null runs must produce shortlists (got ${shortlisted}); otherwise the test proves nothing`);
  assert.ok(passes <= 1, `null look passes ${passes} of ${shortlisted}`);
});

test("candle values at or after the CUT are never read and never change a result", () => {
  const base = makeDb({ markets: ALL, phi: mr, seed: 5 });
  const extra = makeDb({ markets: ALL, phi: mr, seed: 5, extraAfterCut: true });
  const bounds = [];
  const spy = (db) => ({ prepare: (sql) => { const s = db.prepare(sql); return { iterate: (...args) => { bounds.push(args); return s.iterate(...args); } }; } });
  const a = mining.discover({ db: spy(base), windows });
  const b = mining.discover({ db: spy(extra), windows });
  assert.deepEqual(a, b, "rows after the CUT change nothing");
  const freeze = mining.freezeRecord(a, "x");
  assert.deepEqual(mining.look({ db: spy(base), freeze, resamples: 500 }), mining.look({ db: spy(extra), freeze, resamples: 500 }));
  for (const args of bounds) assert.ok(args[3] < CUT, `upper bound ${args[3]} is below the CUT`);
});

test("the look refuses a tampered, foreign or already used freeze record", () => {
  const db = makeDb({ markets: ALL, phi: mr, seed: 7 });
  const found = mining.discover({ db, windows });
  const freeze = mining.freezeRecord(found, "x");
  assert.equal(mining.look({ db, freeze: { ...freeze, shortlist: [...freeze.shortlist].reverse().concat("RET1_HIGH_Q90_H1") }, resamples: 200 }).status, "FREEZE_MISMATCH");
  assert.equal(mining.look({ db, freeze: { ...freeze, gridFingerprint: "0".repeat(64) }, resamples: 200 }).status, "FREEZE_MISMATCH");
  assert.equal(mining.look({ db, freeze: { ...freeze, lookedAt: "2026-11-21T00:00:00Z" }, resamples: 200 }).status, "ALREADY_LOOKED");
  assert.equal(mining.look({ db, freeze: { ...freeze, thresholds: { ...freeze.thresholds, [freeze.shortlist[0]]: { limit: 0, n: 1 } } }, resamples: 200 }).status, "FREEZE_MISMATCH");
});

test("too little data is reported, not guessed; the printed result carries aggregates only", () => {
  const empty = new DatabaseSync(":memory:");
  empty.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL, volume REAL)");
  assert.equal(mining.discover({ db: empty, windows }).status, "INSUFFICIENT_DATA");
  const db = makeDb({ markets: ALL, phi: mr, seed: 9 });
  const found = mining.discover({ db, windows });
  const keys = new Set(Object.keys(found));
  for (const k of keys) assert.ok(["status", "gridFingerprint", "trials", "usableDecisionHours", "eligibleRules", "positiveMeanRules", "windows", "shortlist", "thresholds"].includes(k), k);
  for (const s of found.shortlist) assert.deepEqual(Object.keys(s).sort(), ["id", "meanNet", "meanStress", "n", "unresolved"]);
});

test("the time-block bootstrap is one-sided and centred: a clear positive mean is small, a zero-mean series is not", () => {
  const random = makeRandom(1);
  const from = 0; const to = 400 * H;
  const pos = Array.from({ length: 300 }, (_, i) => ({ t: i * H, v: 0.004 + 0.002 * normal(random) }));
  assert.ok(mining.timeBlockBootstrapP(pos, from, to, makeRandom(2), 2000) < 0.01);
  const zero = Array.from({ length: 300 }, (_, i) => ({ t: i * H, v: 0.01 * normal(random) }));
  assert.ok(mining.timeBlockBootstrapP(zero, from, to, makeRandom(2), 2000) > 0.05);
});

test("not testable cases never pass: fewer than two trades, all equal returns (zero variance)", () => {
  assert.equal(mining.timeBlockBootstrapP([{ t: 0, v: 0.01 }], 0, 100 * H, makeRandom(1), 500), 1);
  assert.equal(mining.timeBlockBootstrapP(Array.from({ length: 80 }, (_, i) => ({ t: i * H, v: 0.01 })), 0, 100 * H, makeRandom(1), 500), 1);
  assert.equal(mining.timeBlockBootstrapP([], 0, 100 * H, makeRandom(1), 500), 1);
});

test("simultaneous trades of correlated markets are kept together: a duplicated series is not more significant per hour block than its source", () => {
  const random = makeRandom(4);
  const base = Array.from({ length: 120 }, (_, i) => ({ t: i * H, v: 0.0005 + 0.01 * normal(random) }));
  const dup = base.flatMap((x) => [x, x, x, x]);
  const p1 = mining.timeBlockBootstrapP(base, 0, 130 * H, makeRandom(9), 3000);
  const p4 = mining.timeBlockBootstrapP(dup, 0, 130 * H, makeRandom(9), 3000);
  assert.ok(Math.abs(p4 - p1) < 0.05, `p ${p1} vs ${p4}: four identical markets must not look four times as strong`);
});

test("the stress cost is 2 x fee + 5 bp per side, about 30 bp for the round trip", () => {
  assert.ok(Math.abs(mining.COST - 0.001) < 1e-12);
  assert.ok(Math.abs(mining.STRESS_COST - 0.003) < 1e-12);
});

test("the look needs enough trades: a handful of lucky hold-back trades is not a pass", () => {
  assert.equal(mining.MIN_LOOK_TRADES, 50);
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  const freeze = mining.freezeRecord(found, "x");
  // a hold-back of two days has far fewer than 50 trades per rule at the longer holds: whatever the p-value, an untestable rule never passes
  const short = { ...windows, holdbackStart: CUT - 3 * DAY, holdbackEnd: CUT - 1 * H };
  const f2 = { ...freeze, windows: { ...freeze.windows, holdbackStart: short.holdbackStart, holdbackEnd: short.holdbackEnd } };
  const result = mining.look({ db, freeze: { ...f2, fingerprint: mining.fingerprintOf(f2) }, resamples: 500 });
  for (const c of result.candidates) if (c.n < mining.MIN_LOOK_TRADES) { assert.equal(c.testable, false); assert.equal(c.pass, false); assert.equal(c.p, 1); }
});

test("one-position-per-market logic: a rule never re-enters before its exit; a trade with a missing exit close is skipped, not filled", () => {
  const thresholds = {}; for (const s of mining.SIGNALS) { thresholds[s.id] = { q80: { high: -Infinity, low: Infinity }, q90: { high: -Infinity, low: Infinity } }; }
  const rule = mining.RULES.find((r) => r.id === "RET1_HIGH_Q80_H4");
  const closes = new Map(); const rows = [];
  for (let i = 0; i < 12; i += 1) { closes.set(i * H, 100 + i); rows.push({ t: i * H, values: { RET1: 0.01 } }); }
  closes.delete(9 * H); // the exit close of an entry at hour 5 is missing
  const { trades, unresolved } = mining.tradesFor(rule, rows, closes, thresholds);
  const entries = trades.map((x) => x.t / H);
  assert.deepEqual(entries, [0, 4, 8].filter((h) => closes.has((h + 4) * H)), "entries 4 hours apart; no overlap");
  assert.ok(unresolved >= 1, "the missing exit close is counted, not filled");
});

test("the freeze record carries the source commit and its fingerprint binds it", () => {
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  const a = mining.freezeRecord(found, "x", "a".repeat(40));
  const b = mining.freezeRecord(found, "x", "b".repeat(40));
  assert.equal(a.sourceCommit, "a".repeat(40));
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(mining.look({ db, freeze: { ...a, sourceCommit: "c".repeat(40) }, resamples: 100 }).status, "FREEZE_MISMATCH");
});

test("the PASS rule: enough trades, positive at the base cost AND the stress cost, p below alpha", () => {
  const ok = { n: 60, meanNet: 0.002, meanStress: 0.0005, p: 0.004, alpha: 0.01 };
  assert.equal(mining.passDecision(ok), true);
  assert.equal(mining.passDecision({ ...ok, n: 49 }), false, "too few trades");
  assert.equal(mining.passDecision({ ...ok, meanNet: 0 }), false, "no base edge");
  assert.equal(mining.passDecision({ ...ok, meanStress: -0.0001 }), false, "an edge that does not survive the stress cost");
  assert.equal(mining.passDecision({ ...ok, meanStress: 0 }), false);
  assert.equal(mining.passDecision({ ...ok, p: 0.01 }), false, "p must be below alpha, not equal");
  assert.equal(mining.passDecision({ ...ok, p: 0.5 }), false);
});
