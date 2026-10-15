"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { runStudy, writeResult, RESULT_FILE, START, END } = require("./run-raim-study.js");

const M = 60_000;
function syntheticDb(markets) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_orderbook_samples (market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL, ask_size_5 REAL, total_bid_size REAL, total_ask_size REAL, PRIMARY KEY (market, captured_at_ms))");
  db.exec("CREATE TABLE research_trade_ticks_v2 (market TEXT NOT NULL, traded_at_ms INTEGER NOT NULL, price REAL NOT NULL, volume REAL NOT NULL, side TEXT NOT NULL, PRIMARY KEY (market, traded_at_ms, price, volume, side))");
  const book = db.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, ?, ?, 1, 1, 1, 1)");
  const tick = db.prepare("INSERT INTO research_trade_ticks_v2 VALUES (?, ?, ?, ?, ?)");
  let seed = 11;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  db.exec("BEGIN");
  for (let m = 0; m < markets; m += 1) {
    let mid = 10_000 + m * 100; // price band tick 10; spread 20 = 20 bp
    for (let t = START + M; t <= END; t += M) {
      mid = Math.max(9_000, mid + Math.round((rand() - 0.5) * 20));
      book.run(`KRW-M${m}`, t, mid - 10, mid + 10);
      if (rand() < 0.3) tick.run(`KRW-M${m}`, t + 100 + Math.round(rand() * 1000), mid + (rand() < 0.5 ? -25 : 25), 0.2 + rand(), rand() < 0.5 ? "ASK" : "BID");
    }
  }
  db.exec("COMMIT");
  return db;
}
const now = END + 3 * 3_600_000;

test("waits until the four-day window is complete", () => {
  assert.deepEqual(runStudy({ db: syntheticDb(1), now: START + 2.5 * 86_400_000 }), { status: "WAITING_DATA", daysCollected: 2 });
});

test("runs once complete: fixed fields only, deterministic identity, never independent", () => {
  const result = runStudy({ db: syntheticDb(6), now });
  assert.match(result.status, /^HOLDOUT_(PASS|FAIL)$/);
  assert.equal(result.eligible, 6); assert.equal(result.independent, false);
  assert.match(result.datasetFingerprint, /^[a-f0-9]{64}$/);
  for (const [key, value] of Object.entries(result)) if (key !== "status" && key !== "datasetFingerprint") assert.ok(typeof value === "number" || typeof value === "boolean", key);
  assert.ok(result.baselineFills > 0);
  assert.equal(runStudy({ db: syntheticDb(6), now }).datasetFingerprint, result.datasetFingerprint);
});

test("a stored book or trade stamped after the run time fails closed", () => {
  const db = syntheticDb(6);
  db.prepare("INSERT INTO research_trade_ticks_v2 VALUES (?, ?, ?, ?, ?)").run("KRW-M0", now + 600_000, 10_000, 1, "ASK");
  assert.deepEqual(runStudy({ db, now }), { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" });
});

test("too few eligible markets is reported, not guessed; only a final result is handed off", () => {
  assert.equal(runStudy({ db: syntheticDb(2), now }).status, "INSUFFICIENT_DATA");
  const writes = [];
  const fs = { writeFileSync: (p, c) => writes.push([p, c]), renameSync: () => writes.push(["rename"]) };
  assert.equal(writeResult("/var/lib/nusa/state.sqlite", { status: "WAITING_DATA" }, fs), false);
  assert.equal(writeResult("/var/lib/nusa/state.sqlite", { status: "HOLDOUT_FAIL", eligible: 4 }, fs), true);
  assert.equal(writes[0][0], `/var/lib/nusa/${RESULT_FILE}.tmp`);
});
