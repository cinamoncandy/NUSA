"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const storage = require("../dist/packages/storage/src/index.js");
const sqliteExec = require("../dist/packages/storage/src/durable-execution.js");
const execution = require("../dist/apps/execution/src/durable-execution.js");

function fill(overrides = {}) {
  return {
    fillId: "fill-1", executionId: "exec-1", exchangeTradeId: "trade-1",
    quantity: "1", price: "100", fee: null, feeCurrency: null,
    executedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

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

test("sqlite fills: same trade or fill id with divergent economics throws", () => {
  const db = new storage.SqliteDatabase(":memory:");
  try {
    const repo = new sqliteExec.SqliteDurableExecutionRepository(db);
    repo.appendFill(fill());
    assert.throws(() => repo.appendFill(fill({ price: "101" })), /EXECUTION_FILL_CONFLICT/);
    assert.throws(() => repo.appendFill(fill({ exchangeTradeId: "trade-2" })), /EXECUTION_FILL_CONFLICT/);
    assert.equal(repo.fills("exec-1").length, 1);
  } finally { db.close(); }
});

test("in-memory fills: identical replay is idempotent but divergent economics fail closed", () => {
  const repo = new execution.InMemoryExecutionRepository();
  repo.appendFill(fill());
  repo.appendFill(fill({ fillId: "fill-regenerated" }));
  assert.equal(repo.fills("exec-1").length, 1);
  assert.throws(() => repo.appendFill(fill({ quantity: "2" })), /EXECUTION_FILL_CONFLICT/);
});
