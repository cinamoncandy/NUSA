"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { runStudy, START, END } = require("./run-orderbook-study.js");

function syntheticDb(markets) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_orderbook_samples (market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL NOT NULL, ask_size_5 REAL NOT NULL, total_bid_size REAL NOT NULL, total_ask_size REAL NOT NULL, PRIMARY KEY (market, captured_at_ms))");
  const insert = db.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  db.exec("BEGIN");
  for (let m = 0; m < markets; m += 1) {
    let price = 1000 + m * 10;
    for (let t = START - 5 * 3_600_000; t <= END + 3_600_000; t += 5 * 60_000) {
      price *= 1 + (rand() - 0.5) * 0.004;
      insert.run(`KRW-M${m}`, t, price * 0.9998, price * 1.0002, 1 + rand(), 1 + rand(), 10 + rand(), 10 + rand());
    }
  }
  db.exec("COMMIT");
  return db;
}

test("waits until the pre-registered span has been collected", () => {
  const db = syntheticDb(1);
  assert.deepEqual(runStudy({ db, now: START + 3.5 * 86_400_000 }), { status: "WAITING_DATA", daysCollected: 3 });
});

test("runs once the span is complete and reports only fixed numeric fields", () => {
  const db = syntheticDb(6);
  const result = runStudy({ db, now: END + 3 * 3_600_000 });
  assert.match(result.status, /^HOLDOUT_(PASS|FAIL)$/);
  assert.equal(result.markets, 6);
  assert.equal(result.eligible, 6);
  assert.equal(result.bar, Number((0.05 / 195).toPrecision(3)));
  for (const [key, value] of Object.entries(result)) if (key !== "status" && key !== "datasetFingerprint") assert.ok(typeof value === "number" || typeof value === "boolean", key);
  assert.ok(result.holdoutTrades > 0);
  assert.match(result.datasetFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(result.datasetRows > 0 && result.datasetFirstAt < result.datasetLastAt);
  assert.equal(runStudy({ db: syntheticDb(6), now: END + 3 * 3_600_000 }).datasetFingerprint, result.datasetFingerprint, "deterministic identity for the same data");
});

test("a row stamped after the run time fails closed as DATA_FUTURE", () => {
  const db = syntheticDb(6);
  const now = END + 3 * 3_600_000;
  db.prepare("INSERT INTO research_orderbook_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("KRW-M0", now + 600_000, 100, 101, 1, 1, 1, 1);
  assert.deepEqual(runStudy({ db, now }), { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" });
  assert.notEqual(runStudy({ db, now: now + 600_000 }).status, "DATA_INTEGRITY_FAIL", "the same row is valid once its time has come");
});

test("too few eligible markets is reported, not guessed", () => {
  const db = syntheticDb(2);
  assert.equal(runStudy({ db, now: END + 3 * 3_600_000 }).status, "INSUFFICIENT_DATA");
});
