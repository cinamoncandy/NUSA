const test = require("node:test");
const assert = require("node:assert/strict");
const { ExecutionService, DisabledExchangeExecutionPort } = require("../dist/apps/execution/src/durable-execution.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteDurableExecutionRepository } = require("../dist/packages/storage/src/durable-execution.js");

async function seeded() {
  const db = new SqliteDatabase(":memory:");
  const repo = new SqliteDurableExecutionRepository(db);
  const service = new ExecutionService(repo, new DisabledExchangeExecutionPort());
  const record = await service.createIntent({
    strategyId: "strategy-1", market: "KRW-BTC", side: "BUY", orderType: "MARKET", requestedQuantity: "1",
  });
  await service.approveRisk(record.executionId, "risk-1");
  return { db, repo, record };
}

test("corrupt execution records fail with identity instead of SyntaxError", async () => {
  const { db, repo, record } = await seeded();
  try {
    assert.ok(repo.get(record.executionId));
    db.connection.exec(`UPDATE execution_records SET record_json = 'corrupt{{{' WHERE execution_id = '${record.executionId}'`);
    assert.throws(() => repo.get(record.executionId), /STORED_RECORD_CORRUPT:execution-record/);
    assert.throws(() => repo.listActive(), /STORED_RECORD_CORRUPT:execution-record/);
  } finally { db.close(); }
});

test("corrupt transitions and fills fail with identity", async () => {
  const { db, repo, record } = await seeded();
  try {
    db.connection.exec(`UPDATE execution_transitions SET transition_json = 'corrupt{{{' WHERE execution_id = '${record.executionId}'`);
    assert.throws(() => repo.transitions(record.executionId), /STORED_RECORD_CORRUPT:execution-transition/);
    repo.appendFill({ fillId: "fill-1", executionId: record.executionId, exchangeTradeId: "trade-1", quantity: "1", price: "100", fee: null, feeCurrency: null, executedAt: record.createdAt });
    db.connection.exec("UPDATE execution_fills SET fill_json = 'corrupt{{{' WHERE fill_id = 'fill-1'");
    assert.throws(() => repo.fills(record.executionId), /STORED_RECORD_CORRUPT:execution-fill/);
  } finally { db.close(); }
});
