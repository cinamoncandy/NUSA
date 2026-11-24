"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const mining = require("../scripts/run-history-mining.js");
const { makeRandom } = require("../scripts/run-crossmarket-study.js");
const b = require("../scripts/run-broad-mining.js");

const H = 3_600_000;
const START = b.WINDOWS.discoveryStart;
const BINS = (b.WINDOWS.discoveryEnd - START) / H;

/** Synthetic made-up closes only. */
function walk(seed, from, hours, drift = 0) {
  const closes = new Map(); let p = 100; let s = seed;
  for (let k = 0; k <= hours; k += 1) { s = (s * 1103515245 + 12345) % 2147483648; p *= 1 + drift + (s / 2147483648 - 0.5) * 0.03; closes.set(from + k * H, p); }
  return closes;
}
const marketFrom = (name, closes) => ({ market: name, closes, rows: mining.signalTable(closes, START, b.WINDOWS.discoveryEnd) });
const ruleQ90 = b.HIGH_RULES.find((r) => r.id === "RET48_HIGH_Q90_H24");

test("only the 64 HIGH-side rules of the unchanged grid take part; the windows end before the hold-back with the purge", () => {
  assert.equal(b.HIGH_RULES.length, 64);
  assert.ok(b.HIGH_RULES.every((r) => r.side === "HIGH"));
  assert.ok(b.WINDOWS.discoveryEnd + 96 * H <= Date.parse("2023-07-05T00:00:00Z") + 24 * H);
  assert.equal(b.WINDOWS.discoveryStart, Date.parse("2021-12-20T00:00:00Z"));
});

test("the bin bootstrap equals the frozen time-block bootstrap for the same data and random stream", () => {
  const items = []; const sums = new Float64Array(240); const counts = new Int32Array(240); let s = 7;
  for (let i = 0; i < 400; i += 1) { s = (s * 1103515245 + 12345) % 2147483648; const t = Math.floor((s / 2147483648) * 240); s = (s * 1103515245 + 12345) % 2147483648; const v = (s / 2147483648 - 0.45) * 0.02; items.push({ t: START + t * H, v }); sums[t] += v; counts[t] += 1; }
  for (const block of [24, 72]) {
    const frozen = mining.timeBlockBootstrapP(items, START, START + 240 * H, makeRandom(5), 300, block);
    assert.equal(b.binBootstrapP(sums, counts, makeRandom(5), 300, block), frozen);
  }
});

test("leave-one-out excess: identical markets have zero excess; fewer than 10 markets in an hour skip the trade", () => {
  const closes = walk(11, START - 80 * H, BINS + 30);
  const same = Array.from({ length: 10 }, (_, i) => marketFrom(`KRW-M${i}`, closes));
  const th = mining.thresholdsFrom(same.map((m) => m.rows));
  const base = b.baselines(same, BINS);
  const agg = b.aggregateRule(ruleQ90, same, th, base, BINS);
  assert.ok(agg.n > 50);
  assert.ok(Math.abs(agg.ex) < 1e-9, "identical markets: each trade's excess over the other markets is zero");
  const nine = same.slice(0, 9);
  const aggThin = b.aggregateRule(ruleQ90, nine, th, b.baselines(nine, BINS), BINS);
  assert.equal(aggThin.n, 0);
  assert.ok(aggThin.skippedThinHours > 0, "thin hours are counted, never used");
});

test("leave-one-out excess is positive for a market that outperforms the others at the signal hours", () => {
  const closes = walk(13, START - 80 * H, BINS + 30);
  const boosted = new Map([...closes].map(([t, c], k) => [t, c * (1 + 0.0004 * k)])); // a drift the others do not have
  const ms = [marketFrom("KRW-UP", boosted), ...Array.from({ length: 9 }, (_, i) => marketFrom(`KRW-M${i}`, closes))];
  const th = mining.thresholdsFrom(ms.map((m) => m.rows));
  const agg = b.aggregateRule(ruleQ90, ms, th, b.baselines(ms, BINS), BINS);
  assert.ok(agg.perMarket["KRW-UP"].n > 0);
  assert.ok(agg.perMarket["KRW-UP"].ex > 0);
});

test("level conditions: trades, base and stress mean, excess, both halves on net and excess are all required", () => {
  const ok = { n: 150, net: 3, stress: 1, ex: 1, halves: [{ n: 70, net: 1, ex: 1 }, { n: 80, net: 2, ex: 1 }] };
  assert.equal(b.passesLevelConditions(ok), true);
  assert.equal(b.passesLevelConditions({ ...ok, n: 99 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, stress: -1 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, ex: 0 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 70, net: 1, ex: -1 }, ok.halves[1]] }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 70, net: -1, ex: 1 }, ok.halves[1]] }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 0, net: 0, ex: 0 }, ok.halves[1]] }), false);
});

function storeOf(marketNames, hours, drift = 0) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL)");
  const ins = db.prepare("INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, close) VALUES (?, 60000, ?, ?)");
  db.exec("BEGIN");
  marketNames.forEach((name, i) => { for (const [t, c] of walk(100 + i * 7, START - 80 * H, hours, drift)) ins.run(name, t, c); });
  db.exec("COMMIT");
  return db;
}
const names = Array.from({ length: 12 }, (_, i) => `KRW-S${i}`);

test("discover on synthetic random walks is deterministic, reports aggregates only, and a freeze record binds the result", () => {
  const db = storeOf(names, BINS + 30);
  const a = b.discover({ db, markets: names, listing: {}, resamples: 100 });
  const c = b.discover({ db, markets: names, listing: {}, resamples: 100 });
  assert.deepEqual(a, c);
  assert.ok(["NO_CANDIDATE", "CANDIDATES"].includes(a.status));
  assert.equal(a.trials, 64);
  assert.equal(Object.keys(a.perMarketUsableHours).length, 12);
  for (const s of a.shortlist || []) assert.ok(s.n >= 100 && s.pExcessByBlock.length === 3 && s.pExcessMax === Math.max(...s.pExcessByBlock));
  const fz = b.freezeRecord({ ...a, shortlist: [{ id: "RET48_HIGH_Q90_H24", candidate: true, limit: 0.06, thresholdN: 10 }], alphaPerCandidate: 0.05 }, names, "2026-12-01T00:00:00Z", null);
  assert.equal(fz.fingerprint, b.fingerprintOf(fz));
  assert.deepEqual(fz.shortlist, ["RET48_HIGH_Q90_H24"]);
  assert.equal(fz.vetoedAt, null);
  db.close();
});

test("fewer than 10 loaded markets is INSUFFICIENT_DATA; an invalid market list is refused; the listing wait removes early decision hours", () => {
  const db = storeOf(names.slice(0, 9), BINS + 30);
  assert.throws(() => b.discover({ db, markets: names.slice(0, 9), listing: {} }), /market list invalid/);
  assert.throws(() => b.discover({ db, markets: [...names.slice(0, 9), "bad"], listing: {} }), /market list invalid/);
  db.close();
  const db2 = storeOf(names, BINS + 30);
  const full = b.discover({ db: db2, markets: names, listing: {}, resamples: 50 });
  const late = START + 200 * 24 * H;
  const waited = b.discover({ db: db2, markets: names, listing: { "KRW-S0": late }, resamples: 50 });
  assert.ok(waited.perMarketUsableHours["KRW-S0"] < full.perMarketUsableHours["KRW-S0"] - 24 * 190);
  assert.notEqual(waited.gridFingerprint, full.gridFingerprint, "the listing map is part of the study fingerprint");
  db2.close();
});

test("the grid fingerprint changes with the market list and the committed history grid is still the frozen one", () => {
  assert.notEqual(b.gridFingerprint(names, {}), b.gridFingerprint(names.slice(1), {}));
  assert.equal(b.gridFingerprint(names, {}), b.gridFingerprint([...names].reverse(), {}), "market order does not matter");
  assert.match(mining.GRID_FINGERPRINT, /^[0-9a-f]{64}$/);
});

test("the script prints only the two result lines and never a price", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-broad-mining.js"), "utf8");
  assert.equal((src.match(/console\.log/g) || []).length, 2);
  assert.doesNotMatch(src, /console\.log\([^)]*closes/);
});
