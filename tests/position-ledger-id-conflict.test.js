"use strict";

// P1 remainder after #1652 (which covered execution fills): position ledger
// same-ID divergent payload must fail closed instead of silently returning
// the previously stored entry.

const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../dist/packages/contracts/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");

const { LedgerSide } = contracts;

function entry(id, baseQtyRaw, overrides = {}) {
  return contracts.makePositionLedgerEntry({
    id, walletId: "wallet-1", strategyId: "alpha", symbol: "BTC-USDT",
    side: LedgerSide.BUY, baseQtyRaw, quoteQtyRaw: baseQtyRaw * 10n,
    ts: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", ...overrides,
  });
}

test("identical ledger re-append is a no-op returning the stored entry", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const ledger = new storage.SqlitePositionLedgerRepository(db);
    const first = ledger.append(entry("e-1", 10n));
    const second = ledger.append(entry("e-1", 10n));
    assert.deepEqual(second, first);
    assert.equal(ledger.list().length, 1);
  } finally { db.close(); }
});

test("same ledger id with different content throws and keeps stored entry", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const ledger = new storage.SqlitePositionLedgerRepository(db);
    ledger.append(entry("e-1", 10n));
    assert.throws(() => ledger.append(entry("e-1", 999n)), /ledger id conflict/);
    assert.throws(() => ledger.append(entry("e-1", 10n, { symbol: "ETH-USDT" })), /ledger id conflict/);
    assert.equal(ledger.getById("e-1").baseQtyRaw, 10n);
    assert.equal(ledger.list().length, 1);
  } finally { db.close(); }
});
