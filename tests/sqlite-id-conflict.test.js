"use strict";

// P1 CLOSURE PRIORITY 2: same-ID-different-payload must fail closed instead
// of vanishing into OR IGNORE / DO NOTHING silence. Same-content redelivery
// stays a silent no-op (first-write-wins for replays/reconcile).

const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../dist/packages/contracts/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const sqliteExec = require("../dist/packages/storage/src/durable-execution.js");
const execution = require("../dist/apps/execution/src/durable-execution.js");

const { LedgerSide } = contracts;

function ledgerEntry(id, baseQtyRaw, overrides = {}) {
  return contracts.makePositionLedgerEntry({
    id, walletId: "wallet-1", strategyId: "alpha", symbol: "BTC-USDT",
    side: LedgerSide.BUY, baseQtyRaw, quoteQtyRaw: baseQtyRaw * 10n,
    ts: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", ...overrides,
  });
}

function fill(overrides = {}) {
  return {
    fillId: "fill-1", executionId: "exec-1", exchangeTradeId: "trade-1",
    quantity: "1", price: "100", fee: null, feeCurrency: null,
    executedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

test("position ledger: identical re-append is a no-op returning stored entry", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const ledger = new storage.SqlitePositionLedgerRepository(db);
    const first = ledger.append(ledgerEntry("e-1", 10n));
    const second = ledger.append(ledgerEntry("e-1", 10n));
    assert.deepEqual(second, first);
    assert.equal(ledger.list().length, 1);
  } finally { db.close(); }
});

test("position ledger: same id with different content throws (failure test)", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const ledger = new storage.SqlitePositionLedgerRepository(db);
    ledger.append(ledgerEntry("e-1", 10n));
    assert.throws(() => ledger.append(ledgerEntry("e-1", 999n)), /ledger id conflict/);
    // Stored entry is untouched by the conflicting append.
    assert.equal(ledger.getById("e-1").baseQtyRaw, 10n);
  } finally { db.close(); }
});

test("sqlite fills: identical redelivery and regenerated fillIds are no-ops", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const repo = new sqliteExec.SqliteDurableExecutionRepository(db);
    repo.appendFill(fill());
    repo.appendFill(fill());
    repo.appendFill(fill({ fillId: "fill-regenerated" }));
    assert.equal(repo.fills("exec-1").length, 1);
  } finally { db.close(); }
});

test("sqlite fills: same trade with divergent economics throws (failure test)", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const repo = new sqliteExec.SqliteDurableExecutionRepository(db);
    repo.appendFill(fill());
    assert.throws(() => repo.appendFill(fill({ price: "101" })), /EXECUTION_FILL_CONFLICT/);
    assert.throws(() => repo.appendFill(fill({ exchangeTradeId: "trade-2" })), /EXECUTION_FILL_CONFLICT/);
    assert.equal(repo.fills("exec-1").length, 1);
  } finally { db.close(); }
});

test("in-memory fills: same semantics as sqlite (no-op vs conflict)", () => {
  const repo = new execution.InMemoryExecutionRepository();
  repo.appendFill(fill());
  repo.appendFill(fill({ fillId: "fill-regenerated" }));
  assert.equal(repo.fills("exec-1").length, 1);
  assert.throws(() => repo.appendFill(fill({ quantity: "2" })), /EXECUTION_FILL_CONFLICT/);
});
