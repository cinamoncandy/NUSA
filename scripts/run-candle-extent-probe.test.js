"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { probe } = require("./run-candle-extent-probe.js");

const M = 60_000;
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE research_closed_candles (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, close_time_ms INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, checksum TEXT NOT NULL, volume REAL, PRIMARY KEY (market, interval_ms, close_time_ms))");
  d.exec("CREATE TABLE research_candle_absence (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, first_absent_close_ms INTEGER NOT NULL, last_absent_close_ms INTEGER NOT NULL, before_close_ms INTEGER NOT NULL, after_close_ms INTEGER NOT NULL, evidence_fingerprint_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL, checksum TEXT NOT NULL, PRIMARY KEY (market, interval_ms, first_absent_close_ms, last_absent_close_ms))");
  return d;
}

test("counts, first and last close, proven-absent and missing minutes per market; no value is selected", () => {
  const d = db();
  const ins = d.prepare("INSERT INTO research_closed_candles VALUES ('KRW-BTC', ?, ?, 1, 1, 1, 1, 'x', 1)");
  const base = 1_000 * 60 * M;
  for (let k = 0; k < 10; k += 1) if (k !== 3 && k !== 4 && k !== 7) ins.run(M, base + k * M);
  d.prepare("INSERT INTO research_candle_absence VALUES ('KRW-BTC', ?, ?, ?, ?, ?, 'f', 't', 'c')").run(M, base + 3 * M, base + 3 * M, base + 2 * M, base + 5 * M);
  ins.run(5 * M, base);
  const out = probe(d);
  assert.equal(out.status, "OK");
  assert.equal(out.BTCRows, 7); assert.equal(out.BTCFirstMs, base); assert.equal(out.BTCLastMs, base + 9 * M);
  assert.equal(out.BTCAbsentMinutes, 1);
  assert.equal(out.BTCMissingMinutes, 2, "10 minutes - 7 stored - 1 proven absent");
  assert.equal(out.XRPRows, 0); assert.equal(out.XRPFirstMs, 0); assert.equal(out.XRPMissingMinutes, 0);
  for (const v of Object.values(out)) assert.ok(v === "OK" || Number.isSafeInteger(v));
});

test("the source selects no candle value column", () => {
  const text = require("node:fs").readFileSync(require.resolve("./run-candle-extent-probe.js"), "utf8");
  const sql = [...text.matchAll(/prepare\("([^"]+)"\)/g)].map((m) => m[1]).join(" ");
  assert.ok(!/\b(open|high|low|close|volume)\b(?!_)/.test(sql.replace(/close_time_ms/g, "").replace(/research_closed_candles/g, "")), sql);
});

test("fails closed without a state path", () => {
  const r = spawnSync(process.execPath, [require.resolve("./run-candle-extent-probe.js")], { env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: "" }, encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr, /CANDLE_EXTENT_FAILED_CLOSED/);
});
