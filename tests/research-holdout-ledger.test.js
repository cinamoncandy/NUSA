const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { SqliteDatabase, SqliteResearchHoldoutLedger, ResearchHoldoutLedgerError } = require("../dist/packages/storage/src/index.js");

const M = 60_000;
const key = (over = {}) => ({ strategyConfigHash: "a".repeat(64), market: "KRW-BTC", intervalMs: M, holdoutStartMs: 100 * M, holdoutEndMs: 102 * M, ...over });
const open = (filename) => {
  const path = filename ?? join(mkdtempSync(join(tmpdir(), "nusa-holdout-")), "h.db");
  const db = new SqliteDatabase(path);
  return { path, db, ledger: new SqliteResearchHoldoutLedger(db) };
};

test("migration 027 exists and a holdout is claimed once, then refused", () => {
  const { db, ledger } = open();
  assert.equal(db.migrationResult.currentVersion, "027_research_holdout_usage");
  assert.equal(ledger.isUsed(key()), false);
  assert.equal(ledger.claim(key(), "eval-1", 5 * M), "CLAIMED");
  assert.equal(ledger.isUsed(key()), true);
  assert.equal(ledger.claim(key(), "eval-2", 6 * M), "ALREADY_USED");
  assert.equal(ledger.count(), 1);
  db.close();
});

test("a different configuration, market, interval or window is a separate claim", () => {
  const { db, ledger } = open();
  assert.equal(ledger.claim(key(), "e1", M), "CLAIMED");
  assert.equal(ledger.claim(key({ strategyConfigHash: "b".repeat(64) }), "e2", M), "CLAIMED");
  assert.equal(ledger.claim(key({ market: "KRW-ETH" }), "e3", M), "CLAIMED");
  assert.equal(ledger.claim(key({ holdoutStartMs: 103 * M, holdoutEndMs: 105 * M }), "e4", M), "CLAIMED");
  assert.equal(ledger.count(), 4);
  db.close();
});

test("a claim survives reopening the database (restart safety)", () => {
  const first = open();
  first.ledger.claim(key(), "eval-1", M);
  first.db.close();
  const second = open(first.path);
  assert.equal(second.ledger.isUsed(key()), true);
  assert.equal(second.ledger.claim(key(), "eval-9", 9 * M), "ALREADY_USED");
  second.db.close();
});

test("overlapping windows of the same configuration count as used even when not identical", () => {
  const { db, ledger } = open();
  ledger.claim(key({ holdoutStartMs: 100 * M, holdoutEndMs: 110 * M }), "e1", M);
  const h = "a".repeat(64);
  assert.equal(ledger.overlapsUsedHoldout(h, "KRW-BTC", M, 105 * M, 115 * M), true);
  assert.equal(ledger.overlapsUsedHoldout(h, "KRW-BTC", M, 95 * M, 100 * M), true);
  assert.equal(ledger.overlapsUsedHoldout(h, "KRW-BTC", M, 111 * M, 120 * M), false);
  assert.equal(ledger.overlapsUsedHoldout(h, "KRW-BTC", M, 80 * M, 99 * M), false);
  assert.equal(ledger.overlapsUsedHoldout("c".repeat(64), "KRW-BTC", M, 105 * M, 115 * M), false);
  assert.equal(ledger.overlapsUsedHoldout(h, "KRW-ETH", M, 105 * M, 115 * M), false);
  db.close();
});

test("invalid keys, evaluation ids and clocks are rejected without writing", () => {
  const { db, ledger } = open();
  const bad = [key({ strategyConfigHash: "x" }), key({ market: "BTC-KRW" }), key({ intervalMs: 5 }), key({ holdoutStartMs: 0 }), key({ holdoutEndMs: 1 }), key({ holdoutStartMs: 1.5 })];
  for (const k of bad) assert.throws(() => ledger.claim(k, "e", M), (e) => e instanceof ResearchHoldoutLedgerError && e.code === "INVALID_KEY");
  assert.throws(() => ledger.claim(key(), " ", M), (e) => e.code === "INVALID_EVALUATION");
  assert.throws(() => ledger.claim(key(), "e", 0), (e) => e.code === "INVALID_CLOCK");
  assert.equal(ledger.count(), 0);
  db.close();
});
