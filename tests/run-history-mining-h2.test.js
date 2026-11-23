"use strict";

// H2 script changes of the history mining (docs/RESEARCH_HISTORY_MINING_OFFLINE_HISTORY_DESIGN_2026-11-23.md section 5;
// WO-LEARNING-20261123-HISTORY-MINING-H2-SCRIPT-CHANGES). Synthetic made-up series only: no real candle value is read or printed.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { makeRandom } = require("../scripts/run-crossmarket-study.js");
const mining = require("../scripts/run-history-mining.js");

const H = 3_600_000;
const M = 60_000;
const DAY = 24 * H;
const { CUT } = mining;

function normal(random) { const u = Math.max(random(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()); }

/** Hourly closes on the hour. `drift` adds a constant hourly return, `phi` plants mean reversion, `sigma(t)` the volatility, `skip(market, t)` makes a hole. One transaction. */
function makeDb({ markets, phi = {}, drift = 0, sigma = () => 0.005, seed = 1, from = CUT - 60 * DAY, to = CUT, skip = () => false }) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL, volume REAL, PRIMARY KEY(market, interval_ms, close_time_ms))");
  const insert = db.prepare("INSERT INTO research_closed_candles(market, interval_ms, close_time_ms, close, volume) VALUES (?,?,?,?,?)");
  db.exec("BEGIN");
  markets.forEach((market, i) => {
    const random = makeRandom(seed * 100 + i);
    let price = 1000; let last = 0;
    for (let t = from; t < to; t += H) {
      const r = drift + (phi[market] ?? 0) * last + sigma(t) * normal(random);
      price *= 1 + r; last = r - drift;
      if (!skip(market, t)) insert.run(market, M, t, price, 1);
    }
  });
  db.exec("COMMIT");
  return db;
}
const ALL = ["KRW-BTC", "KRW-ETH", "KRW-NEAR", "KRW-SOL", "KRW-XRP"];
const windows = { discoveryStart: CUT - 50 * DAY, discoveryEnd: CUT - 20 * DAY, holdbackStart: CUT - 15 * DAY, holdbackEnd: CUT - 1 * H };
// a longer span (200 days) for the tests that need many hold-back trades at the longer holds
const LONG = { from: CUT - 200 * DAY, windows: { discoveryStart: CUT - 190 * DAY, discoveryEnd: CUT - 100 * DAY, holdbackStart: CUT - 95 * DAY, holdbackEnd: CUT - 1 * H } };
const mr = Object.fromEntries(ALL.map((m) => [m, -0.5]));

test("the grid fingerprint changed: a freeze record of the earlier script (same-close entry, no excess test) cannot bind", () => {
  // the exact fingerprint input of the script before the H2 changes
  const legacyInput = { SIGNALS: mining.SIGNALS.map((s) => s.id), SIDES: ["HIGH", "LOW"], QUANTILES: [0.8, 0.9], HOLDS: [1, 4, 12, 24], FEE: 0.0005, COST: 0.001, STRESS_COST: 0.003, MIN_TRADES: 100, MAX_SHORTLIST: 5, MAX_OVERLAP: 0.5, ALPHA_TOTAL: 0.05, BLOCK: 24, B: 10000, SEED: 20261121, PURGE: 96 * H, CUT };
  const legacy = crypto.createHash("sha256").update(JSON.stringify(legacyInput)).digest("hex");
  assert.notEqual(mining.GRID_FINGERPRINT, legacy);
  assert.equal(mining.ENTRY_RULE, "NEXT_HOURLY_CLOSE");
  assert.deepEqual([...mining.SENSITIVITY_BLOCKS], [72, 168]);
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  const old = { ...mining.freezeRecord(found, "x"), gridFingerprint: legacy };
  assert.equal(mining.look({ db, freeze: old, resamples: 100 }).status, "FREEZE_MISMATCH");
});

test("the thresholds and constants of the gates are unchanged", () => {
  assert.equal(mining.MIN_TRADES, 100);
  assert.equal(mining.MIN_LOOK_TRADES, 50);
  assert.equal(mining.PURGE, 96 * H);
  assert.equal(mining.RULES.length, 128);
  assert.equal(mining.COST, 0.001);
  assert.ok(Math.abs(mining.STRESS_COST - 0.003) < 1e-12);
});

test("entry is at the NEXT hourly close, never at the close that produced the signal", () => {
  const thresholds = {}; for (const s of mining.SIGNALS) thresholds[s.id] = { q80: { high: -Infinity, low: Infinity }, q90: { high: -Infinity, low: Infinity } };
  const rule = mining.RULES.find((r) => r.id === "RET1_HIGH_Q80_H1");
  // a +10% jump from hour 5 to hour 6 (the signal of decision hour 6 itself) and flat otherwise
  const closes = new Map(); const rows = [];
  for (let i = 0; i < 12; i += 1) { closes.set(i * H, i >= 6 ? 110 : 100); rows.push({ t: i * H, values: { RET1: 0.01 } }); }
  const { trades } = mining.tradesFor(rule, rows, closes, thresholds);
  const at5 = trades.find((x) => x.t === 5 * H);
  assert.ok(at5 !== undefined);
  assert.ok(Math.abs(at5.gross - (closes.get(7 * H) / closes.get(6 * H) - 1)) < 1e-12, "decision 5 enters at close 6 and exits at close 7");
  assert.ok(Math.abs(at5.gross) < 1e-12, "the jump between close 5 and close 6 is not earned by a decision taken at close 5");
  const at4 = trades.find((x) => x.t === 4 * H);
  assert.ok(Math.abs(at4.gross - 0.1) < 1e-12, "the jump is earned only by the decision taken one hour before it");
  // for hold 1 every hour trades (the entry of the next decision is the exit of the previous); the last decision needs a close two hours later
  assert.deepEqual(trades.map((x) => x.t / H), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("baseline: the mean net of entering at every usable hour with the same hold, per market and per quarter", () => {
  const g = 0.001; const closes = new Map(); const rows = [];
  for (let i = 0; i < 40; i += 1) { closes.set(i * H, 100 * (1 + g) ** i); rows.push({ t: i * H, values: { RET1: 0.01 } }); }
  const base = mining.baselineFor(4, [{ market: "KRW-BTC", closes, rows }]);
  const b = base.byMarket.get("KRW-BTC");
  assert.ok(Math.abs(b.mean - ((1 + g) ** 4 - 1 - mining.COST)) < 1e-12);
  assert.equal(b.n, 40 - 5, "decision hours whose entry (t + 1 h) or exit (t + 1 h + hold) close is missing are not counted");
  assert.equal(mining.quarterOf(Date.parse("2023-07-01T00:00:00Z")), "2023Q3");
  assert.equal(mining.quarterOf(Date.parse("2024-03-31T23:00:00Z")), "2024Q1");
  assert.ok([...base.byQuarter.keys()].every((k) => k.startsWith("KRW-BTC|1970Q1")));
  // a trade equal to the baseline has zero excess; a trade above it has positive excess
  const t0 = { market: "KRW-BTC", t: 0, gross: (1 + g) ** 4 - 1 };
  assert.ok(Math.abs(mining.excessOf(t0, base)) < 1e-12);
  assert.ok(mining.excessOf({ ...t0, gross: t0.gross + 0.01 }, base) > 0.0099);
});

test("a drift-only rule passes the old test but not the excess test: a trending sample is not an edge", () => {
  // every market drifts up 0.03 percent per hour with no structure: every rule has a clearly positive net, none has an excess
  let sawPositiveNet = 0;
  for (const seed of [21, 22, 23]) {
    const db = makeDb({ markets: ALL, drift: 0.0003, seed, from: LONG.from });
    const found = mining.discover({ db, windows: LONG.windows });
    assert.equal(found.status, "SHORTLIST");
    const result = mining.look({ db, freeze: mining.freezeRecord(found, "x"), resamples: 1000 });
    assert.equal(result.status, "LOOK_FAIL", `seed ${seed}`);
    for (const c of result.candidates) {
      assert.ok(c.testable);
      if (c.meanNet > 0 && c.meanStress > 0 && c.p < result.alphaPerCandidate) { sawPositiveNet += 1; assert.equal(c.pass, false); assert.ok(!(c.excess > 0 && c.pExcess < result.alphaPerCandidate), "no excess"); }
    }
  }
  assert.ok(sawPositiveNet >= 2, `the drift must make the old rule pass for the test to prove something (saw ${sawPositiveNet})`);
});

test("planted mean reversion on top of a drift still passes the excess rule; tables, break-even, sensitivity and drift disclosure are filled", () => {
  // phi -0.9 on the hourly return: with the next-close entry the planted effect shows as a lag-2 edge of the HIGH rules
  const strong = Object.fromEntries(ALL.map((m) => [m, -0.9]));
  const db = makeDb({ markets: ALL, phi: strong, drift: 0.0001, seed: 3 });
  const found = mining.discover({ db, windows });
  assert.equal(found.status, "SHORTLIST");
  const result = mining.look({ db, freeze: mining.freezeRecord(found, "x"), resamples: 1000 });
  assert.equal(result.status, "LOOK_PASS");
  assert.equal(result.entryRule, "NEXT_HOURLY_CLOSE");
  assert.equal(result.passRule, "NET_STRESS_EXCESS_V2");
  assert.equal(result.testable, true);
  const c = result.candidates.find((x) => x.pass);
  assert.ok(c.excess > 0 && c.pExcess < result.alphaPerCandidate);
  assert.ok(c.meanNet > 0 && c.meanStress > 0);
  // break-even cost: the round-trip cost at which the mean net is zero = mean gross = meanNet + the base cost
  assert.ok(Math.abs(c.breakEvenCost - (c.meanNet + mining.COST)) < 2e-6, `${c.breakEvenCost} vs ${c.meanNet}`);
  assert.ok(c.breakEvenCost > mining.COST);
  // sensitivity blocks 72 and 168 (descriptive)
  assert.deepEqual(Object.keys(c.sensitivity), ["block72", "block168"]);
  for (const k of ["block72", "block168"]) for (const f of ["p", "pExcess"]) assert.ok(c.sensitivity[k][f] > 0 && c.sensitivity[k][f] <= 1);
  // sign tables: the hold-back markets only (no XRP), the quarters of the window, consistent signs
  assert.deepEqual(c.tables.byMarket.map((r) => r.key), ["KRW-BTC", "KRW-ETH", "KRW-NEAR", "KRW-SOL"].filter((m) => c.tables.byMarket.some((r) => r.key === m)));
  assert.ok(c.tables.byMarket.every((r) => r.key !== "KRW-XRP"));
  assert.ok(c.tables.byQuarter.length >= 1 && c.tables.byQuarter.every((r) => /^\d{4}Q[1-4]$/.test(r.key)));
  for (const r of [...c.tables.byMarket, ...c.tables.byQuarter]) {
    assert.ok(r.n >= 1);
    assert.equal(r.signNet, r.meanNet > 0 ? "+" : r.meanNet < 0 ? "-" : "0");
    assert.equal(r.signExcess, r.excess > 0 ? "+" : r.excess < 0 ? "-" : "0");
  }
  assert.equal(c.tables.byMarket.reduce((s, r) => s + r.n, 0), c.n);
  assert.equal(c.tables.byQuarter.reduce((s, r) => s + r.n, 0), c.n);
  // the printed result holds aggregates only: no field is a candle price series
  assert.ok(Object.keys(c.entryRateDrift).sort().join() === ["nominalRate", "ratio", "signalRate", "tradesPerUsableHour", "usableHours"].join());
});

test("the block parameter of the bootstrap is respected and the default stays 24", () => {
  const random = makeRandom(5);
  const items = Array.from({ length: 300 }, (_, i) => ({ t: i * H, v: 0.002 + 0.01 * normal(random) }));
  const a = mining.timeBlockBootstrapP(items, 0, 320 * H, makeRandom(2), 1000);
  const b = mining.timeBlockBootstrapP(items, 0, 320 * H, makeRandom(2), 1000, 24);
  const c = mining.timeBlockBootstrapP(items, 0, 320 * H, makeRandom(2), 1000, 168);
  assert.equal(a, b);
  assert.ok(c > 0 && c <= 1);
});

test("a hold-back with too few trades is LOOK_FAIL with testable:false and never a pass", () => {
  const db = makeDb({ markets: ALL, phi: mr, seed: 3 });
  const found = mining.discover({ db, windows });
  const f = mining.freezeRecord(found, "x");
  const short = { ...f, windows: { ...f.windows, holdbackStart: CUT - 24 * H, holdbackEnd: CUT - 1 * H } };
  const result = mining.look({ db, freeze: { ...short, fingerprint: mining.fingerprintOf(short) }, resamples: 300 });
  assert.equal(result.status, "LOOK_FAIL");
  assert.equal(result.testable, false);
  assert.equal(result.reason, "UNDER_MIN_LOOK_TRADES");
  for (const c of result.candidates) { assert.ok(c.n < mining.MIN_LOOK_TRADES); assert.equal(c.testable, false); assert.equal(c.pass, false); assert.equal(c.p, 1); assert.equal(c.pExcess, 1); }
});

test("entry-rate drift: a calmer hold-back lowers the rate at which a frozen threshold is reached", () => {
  // discovery is volatile, the hold-back is nearly flat: thresholds from discovery are rarely reached
  const calmFrom = windows.holdbackStart - 80 * H;
  const db = makeDb({ markets: ALL, seed: 31, sigma: (t) => (t >= calmFrom ? 0.0003 : 0.02) });
  const found = mining.discover({ db, windows });
  assert.equal(found.status, "SHORTLIST");
  const result = mining.look({ db, freeze: mining.freezeRecord(found, "x"), resamples: 200 });
  assert.ok(result.candidates.every((c) => Number.isFinite(c.entryRateDrift.ratio)));
  const scale = result.candidates.filter((c) => /^RET\d+_/.test(c.id)); // scale-dependent, no ties at the limit
  for (const c of scale) assert.ok(c.entryRateDrift.ratio < 0.5, `${c.id} ratio ${c.entryRateDrift.ratio}`);
  if (result.candidates.every((c) => c.n < mining.MIN_LOOK_TRADES)) { assert.equal(result.status, "LOOK_FAIL"); assert.equal(result.testable, false); }
});

test("signalRate is the share of usable decision hours beyond the frozen limit", () => {
  const rule = mining.RULES.find((r) => r.id === "RET1_HIGH_Q80_H1");
  const thresholds = {}; for (const s of mining.SIGNALS) thresholds[s.id] = { q80: { high: undefined, low: undefined }, q90: { high: undefined, low: undefined } };
  thresholds.RET1.q80.high = 0.01;
  const rows = [0.02, 0.01, 0.005, -0.01].map((v, i) => ({ t: i * H, values: { RET1: v } }));
  const r = mining.signalRate(rule, [{ market: "KRW-BTC", closes: new Map(), rows }], thresholds);
  assert.deepEqual({ hit: r.hit, all: r.all, rate: r.rate }, { hit: 2, all: 4, rate: 0.5 });
});

test("the discover line carries the usable decision hours per market; a market with holes shows fewer", () => {
  const hole = (market, t) => market === "KRW-NEAR" && Math.floor(t / H) % 100 < 80;
  const db = makeDb({ markets: ALL, seed: 41, skip: hole });
  const found = mining.discover({ db, windows });
  const pm = found.perMarketUsableHours;
  assert.deepEqual(Object.keys(pm), ["KRW-BTC", "KRW-ETH", "KRW-NEAR", "KRW-SOL", "KRW-XRP"]);
  assert.equal(Object.values(pm).reduce((s, x) => s + x, 0), found.usableDecisionHours);
  assert.ok(pm["KRW-NEAR"] < pm["KRW-BTC"] / 2, "holes remove decision hours (a missing close breaks the lookback)");
  assert.ok(Object.values(pm).every(Number.isInteger));
  const empty = new DatabaseSync(":memory:");
  empty.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL, volume REAL)");
  const none = mining.discover({ db: empty, windows });
  assert.equal(none.status, "INSUFFICIENT_DATA");
  assert.ok(Object.values(none.perMarketUsableHours).every((x) => x === 0));
});
