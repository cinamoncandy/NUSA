const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");

const databasePath = () => join(mkdtempSync(join(tmpdir(), "dokkaebi-recovery-drill-")), "paper.db");

test("recovery drill preserves durable state across close and reopen", () => {
  const filename = databasePath();
  const first = new SqliteDatabase(filename);
  first.connection.prepare(
    "INSERT INTO position_ledger_entries (id, wallet_id, strategy_id, symbol, side, base_qty_raw, quote_qty_raw, ts, created_at, source_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("drill-1", "wallet", null, "KRW-BTC", "BUY", "2", "100", "2026-01-01", "2026-01-01", null);
  first.close();

  const reopened = new SqliteDatabase(filename);
  try {
    assert.equal(reopened.connection.prepare("SELECT id FROM position_ledger_entries WHERE id = ?").get("drill-1").id, "drill-1");
    assert.equal(Object.values(reopened.connection.prepare("PRAGMA quick_check").get())[0], "ok");
  } finally { reopened.close(); }
});

test("recovery drill fails closed for a corrupted database", () => {
  const filename = databasePath();
  writeFileSync(filename, Buffer.from("not-a-sqlite-database"));
  assert.throws(() => new SqliteDatabase(filename), /sqlite|file is not a database/i);
});
