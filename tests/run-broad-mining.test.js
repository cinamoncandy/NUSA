"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
const SHA = "a".repeat(40);
const WIDE = [{ tick: 0.0001, lowestCurrentPrice: 0.0001, highestCurrentPrice: 1e12 }];
const TIERS = [{ tick: 0.1, lowestCurrentPrice: 11.6, highestCurrentPrice: 99.2 }, { tick: 1, lowestCurrentPrice: 83.7, highestCurrentPrice: 4924 }];

/** Synthetic made-up closes only. `trend` adds a slowly changing drift (a planted persistence effect). */
function walk(seed, from, hours, { drift = 0, trend = 0, vol = 0.03 } = {}) {
  const closes = new Map(); let p = 100; let s = seed; let d = 0;
  for (let k = 0; k <= hours; k += 1) {
    s = (s * 1103515245 + 12345) % 2147483648; const u = s / 2147483648 - 0.5;
    s = (s * 1103515245 + 12345) % 2147483648; d = 0.985 * d + (s / 2147483648 - 0.5) * trend;
    p *= 1 + drift + d + u * vol; closes.set(from + k * H, p);
  }
  return closes;
}
const marketFrom = (name, closes, floor = 0.0005) => ({ market: name, closes, rows: mining.signalTable(closes, START, b.WINDOWS.discoveryEnd), floor });
const ruleQ90 = b.HIGH_RULES.find((r) => r.id === "RET48_HIGH_Q90_H24");
const listingOf = (names, ms = 0) => Object.fromEntries(names.map((n) => [n, ms]));

test("only the 64 HIGH-side rules of the unchanged grid take part; the windows end before the hold-back with the purge", () => {
  assert.equal(b.HIGH_RULES.length, 64);
  assert.ok(b.HIGH_RULES.every((r) => r.side === "HIGH"));
  assert.ok(b.WINDOWS.discoveryEnd + 96 * H <= Date.parse("2023-07-05T00:00:00Z"), "the 96 hour purge before the hold-back");
  assert.equal(b.WINDOWS.discoveryStart, Date.parse("2021-12-20T00:00:00Z"));
});

test("the unchanged H2 script keeps its pinned hash and grid fingerprint", () => {
  // The pinned hash is of the committed (LF) bytes; a Windows checkout may convert line endings.
  const text = Buffer.from(fs.readFileSync(path.join(__dirname, "..", "scripts", "run-history-mining.js"), "utf8").replace(/\r\n/g, "\n"), "utf8");
  assert.equal(crypto.createHash("sha256").update(text).digest("hex"), "6914d619ff2724d94545e7417fba8529230a0b6d057dd455858ff0c19cd4da1d");
  assert.equal(mining.GRID_FINGERPRINT, "045ff2d52f216eb8e3425c65ef926fd82903924fbf5874b8528f55f7951b2c77");
});

test("the bin bootstrap equals the frozen time-block bootstrap for blocks 24, 72 and 168, and handles all-equal values like the frozen one", () => {
  const items = []; const sums = new Float64Array(400); const counts = new Int32Array(400); let s = 7;
  for (let i = 0; i < 600; i += 1) { s = (s * 1103515245 + 12345) % 2147483648; const t = Math.floor((s / 2147483648) * 400); s = (s * 1103515245 + 12345) % 2147483648; const v = (s / 2147483648 - 0.45) * 0.02; items.push({ t: START + t * H, v }); sums[t] += v; counts[t] += 1; }
  for (const block of [24, 72, 168]) assert.equal(b.binBootstrapP(sums, counts, makeRandom(5), 300, block, true), mining.timeBlockBootstrapP(items, START, START + 400 * H, makeRandom(5), 300, block));
  const eqSums = new Float64Array(50); const eqCounts = new Int32Array(50); const eqItems = [];
  for (let i = 0; i < 50; i += 1) { eqSums[i] = 0.1 + 0.2; eqCounts[i] = 1; eqItems.push({ t: START + i * H, v: 0.1 + 0.2 }); }
  assert.equal(mining.timeBlockBootstrapP(eqItems, START, START + 50 * H, makeRandom(1), 100, 24), 1);
  assert.equal(b.binBootstrapP(eqSums, eqCounts, makeRandom(1), 100, 24, false), 1);
});

test("leave-one-out excess: identical markets have zero excess; fewer than 10 markets in an hour skip the trade", () => {
  const closes = walk(11, START - 80 * H, BINS + 30);
  const same = Array.from({ length: 10 }, (_, i) => marketFrom(`KRW-M${i}`, closes));
  const th = mining.thresholdsFrom(same.map((m) => m.rows));
  const agg = b.aggregateRule(ruleQ90, same, th, b.baselines(same, BINS), BINS);
  assert.ok(agg.n > 50);
  assert.ok(Math.abs(agg.ex) < 1e-9, "identical markets: each trade's excess over the other markets is zero");
  const nine = same.slice(0, 9);
  const aggThin = b.aggregateRule(ruleQ90, nine, th, b.baselines(nine, BINS), BINS);
  assert.equal(aggThin.n, 0);
  assert.ok(aggThin.skippedThinHours > 0, "thin hours are counted, never used");
  // the 10-market boundary with NON-identical markets: ten markets trade, nine do not
  const mixed = Array.from({ length: 10 }, (_, i) => marketFrom(`KRW-X${i}`, walk(300 + i, START - 80 * H, BINS + 30)));
  const thm = mining.thresholdsFrom(mixed.map((m) => m.rows));
  assert.ok(b.aggregateRule(ruleQ90, mixed, thm, b.baselines(mixed, BINS), BINS).n > 0);
  assert.equal(b.aggregateRule(ruleQ90, mixed.slice(0, 9), thm, b.baselines(mixed.slice(0, 9), BINS), BINS).n, 0);
});

test("excess is positive for a market that outperforms the others; a larger spread floor lowers net and stress but leaves the excess unchanged", () => {
  const closes = walk(13, START - 80 * H, BINS + 30);
  const boosted = new Map([...closes].map(([t, c], k) => [t, c * (1 + 0.0004 * k)]));
  const build = (floor) => [marketFrom("KRW-UP", boosted, floor), ...Array.from({ length: 9 }, (_, i) => marketFrom(`KRW-M${i}`, closes, floor))];
  const run = (ms) => { const th = mining.thresholdsFrom(ms.map((m) => m.rows)); return b.aggregateRule(ruleQ90, ms, th, b.baselines(ms, BINS), BINS); };
  const cheap = run(build(0.0005)); const dear = run(build(0.002));
  assert.ok(cheap.perMarket["KRW-UP"].n > 0 && cheap.perMarket["KRW-UP"].ex > 0);
  assert.ok(Math.abs(cheap.ex - dear.ex) < 1e-9, "the excess is measured on gross returns");
  assert.ok(Math.abs((cheap.net - dear.net) / cheap.n - 0.0015) < 1e-9, "net falls by the floor difference per trade");
  assert.ok(Math.abs((cheap.stress - dear.stress) / cheap.n - 0.0015) < 1e-9, "the stress case carries the floor once on top of the doubled fee");
});

test("level conditions: trades, base and stress mean, excess, both halves (at least 20 trades each) on net and excess are all required", () => {
  const ok = { n: 150, net: 3, stress: 1, ex: 1, halves: [{ n: 70, net: 1, ex: 1 }, { n: 80, net: 2, ex: 1 }] };
  assert.equal(b.passesLevelConditions(ok), true);
  assert.equal(b.passesLevelConditions({ ...ok, n: 99 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, stress: -1 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, ex: 0 }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 70, net: 1, ex: -1 }, ok.halves[1]] }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 70, net: -1, ex: 1 }, ok.halves[1]] }), false);
  assert.equal(b.passesLevelConditions({ ...ok, halves: [{ n: 19, net: 1, ex: 1 }, ok.halves[1]] }), false);
});

function storeOf(marketNames, hours, opts) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL)");
  const ins = db.prepare("INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, close) VALUES (?, 60000, ?, ?)");
  db.exec("BEGIN");
  marketNames.forEach((name, i) => { for (const [t, c] of walk(100 + i * 7, START - 80 * H, hours, opts)) ins.run(name, t, c); });
  db.exec("COMMIT");
  return db;
}
const names = Array.from({ length: 12 }, (_, i) => `KRW-S${i}`);

test("discover on synthetic random walks is deterministic, reports aggregates only, and a freeze record (also for a stop) binds the result", () => {
  const db = storeOf(names, BINS + 30);
  const input = { db, markets: names, listing: listingOf(names), tierTable: TIERS, resamples: 100 };
  const a = b.discover(input); const c = b.discover(input);
  assert.deepEqual(a, c);
  assert.ok(["NO_CANDIDATE", "CANDIDATES"].includes(a.status));
  assert.equal(a.trials, 64);
  assert.match(a.pValueNote, /do not account for the choice among the 64 rules/);
  const fz = b.freezeRecord(a, names, "2026-12-01T00:00:00Z", SHA);
  assert.equal(fz.fingerprint, b.fingerprintOf(fz));
  assert.equal(fz.status, a.status);
  assert.equal(fz.vetoedAt, null);
  assert.throws(() => b.freezeRecord(a, names, "2026-12-01T00:00:00Z", null), /source commit sha required/);
  db.close();
});

test("a planted momentum effect produces candidates through the whole path: shortlist, overlap limit, halves, p below alpha, freeze record", () => {
  const db = storeOf(names, BINS + 30, { trend: 0.002, vol: 0.02 });
  const r = b.discover({ db, markets: names, listing: listingOf(names), tierTable: WIDE, resamples: 200 });
  assert.equal(r.status, "CANDIDATES", JSON.stringify({ s: r.status, eligible: r.eligibleRules, short: (r.shortlist || []).map((x) => [x.id, x.n, x.meanNet, x.meanExcess, x.pExcessMax]) }));
  assert.ok(r.shortlist.length >= 1 && r.shortlist.length <= 5);
  for (const s of r.shortlist) { assert.ok(s.n >= 100 && s.meanNet > 0 && s.meanStress > 0 && s.meanExcess > 0); assert.ok(s.halves.every((h) => h.n >= 20 && h.meanNet > 0 && h.meanExcess > 0)); assert.equal(s.pExcessMax, Math.max(...s.pExcessByBlock)); assert.equal(s.candidate, s.pExcessMax < r.alphaPerCandidate); }
  assert.ok(r.candidates.length >= 1);
  const fz = b.freezeRecord(r, names, "2026-12-01T00:00:00Z", SHA);
  assert.deepEqual(fz.shortlist, r.candidates);
  assert.equal(fz.shortlistSize, r.shortlist.length);
  db.close();
});

test("inputs are validated: duplicates, a missing or non-numeric listing day, a bad tier table, fewer than 10 markets, a market without candles", () => {
  const db = storeOf(names, BINS + 30);
  const ok = { db, markets: names, listing: listingOf(names), tierTable: TIERS, resamples: 20 };
  assert.throws(() => b.discover({ ...ok, markets: [...names, names[0]] }), /market list invalid/);
  assert.throws(() => b.discover({ ...ok, markets: names.slice(0, 9) }), /market list invalid/);
  assert.throws(() => b.discover({ ...ok, markets: [...names.slice(0, 11), "bad"] }), /market list invalid/);
  assert.throws(() => b.discover({ ...ok, listing: { ...listingOf(names), "KRW-S3": undefined } }), /listing map misses a market/);
  assert.throws(() => b.discover({ ...ok, listing: { ...listingOf(names), "KRW-S3": "2022-01-01" } }), /listing map misses a market/);
  assert.throws(() => b.discover({ ...ok, listing: [] }), /listing map invalid/);
  assert.throws(() => b.discover({ ...ok, tierTable: [] }), /tier table invalid/);
  assert.throws(() => b.discover({ ...ok, markets: [...names.slice(0, 11), "KRW-NOPE"], listing: listingOf([...names.slice(0, 11), "KRW-NOPE"]) }), /a requested market has no candles/);
  db.close();
});

test("the listing wait removes early decision hours (an unaligned listing time starts at the next full hour); the listing map is part of the study fingerprint", () => {
  const db = storeOf(names, BINS + 30);
  const full = b.discover({ db, markets: names, listing: listingOf(names), tierTable: TIERS, resamples: 50 });
  const late = START + 200 * 24 * H + 1234;
  const waited = b.discover({ db, markets: names, listing: { ...listingOf(names), "KRW-S0": late }, tierTable: TIERS, resamples: 50 });
  assert.ok(waited.perMarketUsableHours["KRW-S0"] > 0, "an unaligned time still yields usable hours");
  assert.ok(waited.perMarketUsableHours["KRW-S0"] < full.perMarketUsableHours["KRW-S0"] - 24 * 190);
  assert.notEqual(waited.gridFingerprint, full.gridFingerprint);
  db.close();
});

test("the grid fingerprint changes with the market list and the tier table; market order does not matter", () => {
  assert.notEqual(b.gridFingerprint(names, listingOf(names), TIERS), b.gridFingerprint(names.slice(1), listingOf(names), TIERS));
  assert.notEqual(b.gridFingerprint(names, listingOf(names), TIERS), b.gridFingerprint(names, listingOf(names), [TIERS[0]]));
  assert.equal(b.gridFingerprint(names, listingOf(names), TIERS), b.gridFingerprint([...names].reverse(), listingOf(names), TIERS));
});

test("the script prints only the two result lines and never a price", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-broad-mining.js"), "utf8");
  assert.equal((src.match(/console\.log/g) || []).length, 2);
  assert.doesNotMatch(src, /console\.log\([^)]*closes/);
});
