"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { probe, WINDOW_HOURS } = require("./run-orderbook-gap-probe.js");

const H = 3_600_000;
const M = 60_000;
function db(rows) {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE research_orderbook_samples (market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL NOT NULL, ask_size_5 REAL NOT NULL, total_bid_size REAL NOT NULL, total_ask_size REAL NOT NULL, PRIMARY KEY (market, captured_at_ms))");
  const ins = d.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, 1, 2, 1, 1, 1, 1)");
  for (const [market, t] of rows) ins.run(market, t);
  return d;
}
const NOW = Date.parse("2026-12-01T05:20:00Z");
const END = Math.floor(NOW / H) * H;
const FIRST = END - (WINDOW_HOURS - 1) * H;

test("covered hours, the longest runs and their start times; only the 2 minutes up to a full hour count", () => {
  const rows = [];
  for (let k = 0; k < WINDOW_HOURS; k += 1) {
    const h = FIRST + k * H;
    const missing = (k >= 10 && k < 13) || (k >= 100 && k < 121) || k === 191; // runs of 3, 21 and 1 hours
    if (!missing) rows.push(["KRW-BTC", h - M]);
  }
  rows.push(["KRW-BTC", FIRST + 12 * H + 30 * M]); // a sample 30 minutes after a gap hour does not cover it
  rows.push(["KRW-XRP", FIRST + 12 * H - M]); // another market does not cover it
  const out = probe(db(rows), NOW);
  assert.equal(out.status, "OK"); assert.equal(out.windowHours, 192);
  assert.equal(out.uncoveredHours, 25); assert.equal(out.coveredHours, 167);
  assert.equal(out.longestGapHours, 21); assert.equal(out.gapRuns, 3);
  assert.equal(out.gapOneStartMs, FIRST + 100 * H); assert.equal(out.gapOneHours, 21);
  assert.equal(out.gapTwoStartMs, FIRST + 10 * H); assert.equal(out.gapTwoHours, 3);
  assert.equal(out.gapThreeStartMs, FIRST + 191 * H); assert.equal(out.gapThreeHours, 1);
  assert.ok(!("gapFourStartMs" in out));
  for (const v of Object.values(out)) assert.ok(v === "OK" || Number.isSafeInteger(v));
});

test("an empty table is one gap over the whole window", () => {
  const out = probe(db([]), NOW);
  assert.equal(out.coveredHours, 0); assert.equal(out.uncoveredHours, 192); assert.equal(out.gapRuns, 1); assert.equal(out.gapOneHours, 192);
});

test("the source selects only the sample time, never a price or size", () => {
  const text = require("node:fs").readFileSync(require.resolve("./run-orderbook-gap-probe.js"), "utf8");
  const sql = [...text.matchAll(/prepare\(`([^`]+)`\)/g)].map((m) => m[1]).join(" ");
  assert.match(sql, /SELECT captured_at_ms AS t FROM/);
  assert.ok(!/best_bid|best_ask|size/.test(sql), sql);
});

test("fails closed without a state path", () => {
  const r = spawnSync(process.execPath, [require.resolve("./run-orderbook-gap-probe.js")], { env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: "" }, encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr, /ORDERBOOK_GAPS_FAILED_CLOSED/);
});
