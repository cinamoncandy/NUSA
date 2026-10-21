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

test("only a final result is handed off, atomically, beside the state database", () => {
  const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
  const { writeResult, RESULT_FILE } = require("./run-orderbook-study.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ob-"));
  const dbPath = path.join(dir, "cloud-state.db");
  assert.equal(writeResult(dbPath, { status: "WAITING_DATA", daysCollected: 3 }), false);
  assert.equal(fs.existsSync(path.join(dir, RESULT_FILE)), false);
  assert.equal(writeResult(dbPath, { status: "HOLDOUT_FAIL", eligible: 9, discoveryPass: false, datasetFingerprint: "b".repeat(64) }), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, RESULT_FILE), "utf8"));
  assert.equal(saved.studyId, "ML_ORDERBOOK_60M_20261029");
  assert.equal(saved.schemaVersion, 1);
  assert.equal(fs.existsSync(path.join(dir, `${RESULT_FILE}.tmp`)), false);
});

test("the study gives the same verdict after the collector pruned old rows into the study archive (migration 032), and still works without the archive", () => {
  const full = syntheticDb(6);
  const expected = runStudy({ db: full, now: END + 3 * 3_600_000 });
  const pruned = syntheticDb(6);
  const cols = "market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL NOT NULL, ask_size_5 REAL NOT NULL, total_bid_size REAL NOT NULL, total_ask_size REAL NOT NULL, PRIMARY KEY (market, captured_at_ms)";
  pruned.exec(`CREATE TABLE research_orderbook_study_rows (${cols}) WITHOUT ROWID;`);
  const cutoff = START + 6 * 86_400_000; // everything before day 6 is "older than 14 days"
  const minute = "((captured_at_ms % 3600000) / 60000)";
  pruned.prepare(`INSERT INTO research_orderbook_study_rows SELECT * FROM research_orderbook_samples WHERE captured_at_ms < ? AND (${minute} >= 58 OR ${minute} <= 10 OR ${minute} BETWEEN 43 AND 45)`).run(cutoff);
  const before = Number(pruned.prepare("SELECT COUNT(*) AS n FROM research_orderbook_samples").get().n);
  pruned.prepare("DELETE FROM research_orderbook_samples WHERE captured_at_ms < ?").run(cutoff);
  assert.ok(Number(pruned.prepare("SELECT COUNT(*) AS n FROM research_orderbook_samples").get().n) < before * 0.7, "the prune really removed rows");
  const after = runStudy({ db: pruned, now: END + 3 * 3_600_000 });
  const comparable = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !["datasetFingerprint", "datasetRows", "datasetFirstAt", "datasetLastAt"].includes(k)));
  assert.deepEqual(comparable(after), comparable(expected), "same eligibility, same trades, same verdict numbers");
  // Without the archive the same pruned data has lost its early training days.
  const lossy = syntheticDb(6);
  lossy.prepare("DELETE FROM research_orderbook_samples WHERE captured_at_ms < ?").run(cutoff);
  assert.notDeepEqual(comparable(runStudy({ db: lossy, now: END + 3 * 3_600_000 })), comparable(expected), "pruning without the archive does change the study (that is the defect the archive fixes)");
});
