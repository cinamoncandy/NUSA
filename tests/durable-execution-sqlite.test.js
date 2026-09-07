const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ExecutionService,
  DisabledExchangeExecutionPort,
  allowedExecutionTransitions,
} = require("../dist/apps/execution/src/durable-execution.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteDurableExecutionRepository } = require("../dist/packages/storage/src/durable-execution.js");

const intent = (overrides = {}) => ({ strategyId: "strategy-1", signalId: "signal-1", market: "KRW-BTC", side: "BUY", orderType: "MARKET", requestedQuantity: "2.5", ...overrides });

function sqliteService() {
  const db = new SqliteDatabase(":memory:");
  const repo = new SqliteDurableExecutionRepository(db);
  const service = new ExecutionService(repo, new DisabledExchangeExecutionPort());
  return { db, repo, service };
}

test("storage transition table mirrors the canonical execution table", () => {
  const source = require("node:fs").readFileSync("packages/storage/src/durable-execution.ts", "utf8");
  const canonical = allowedExecutionTransitions();
  for (const [from, targets] of Object.entries(canonical)) {
    assert.ok(source.includes(`${from}: [`), `mirror table missing state ${from}`);
    for (const to of targets) assert.ok(source.includes(`"${to}"`), `mirror table missing edge ${from}->${to}`);
  }
  assert.equal(Object.keys(canonical).length, 16);
});

test("SQLite repository persists approve and reject decisions across restarts", async () => {
  const { db, service } = sqliteService();
  try {
    let approved = await service.createIntent(intent());
    approved = await service.approveRisk(approved.executionId, "risk-1");
    assert.equal(approved.riskDecisionId, "risk-1");
    let rejected = await service.createIntent(intent());
    rejected = await service.rejectRisk(rejected.executionId, "risk-2", "RISK_LIMIT");
    assert.equal(rejected.state, "RISK_REJECTED");
    // Simulate a restart: a new service over the same database must see both decisions.
    const restarted = new ExecutionService(new SqliteDurableExecutionRepository(db), new DisabledExchangeExecutionPort());
    const reloadedApproved = await restarted.getExecution(approved.executionId);
    assert.equal(reloadedApproved.riskDecisionId, "risk-1");
    assert.equal(reloadedApproved.state, "RISK_APPROVED");
    const reloadedRejected = await restarted.getExecution(rejected.executionId);
    assert.equal(reloadedRejected.state, "RISK_REJECTED");
    assert.equal(reloadedRejected.riskDecisionId, "risk-2");
    // A previously rejected intent cannot be approved after restart.
    await assert.rejects(() => restarted.approveRisk(rejected.executionId, "risk-3"), /INVALID_EXECUTION_TRANSITION/);
  } finally { db.close(); }
});

test("SQLite repository rejects illegal state jumps like the in-memory repository", async () => {
  const { db, repo, service } = sqliteService();
  try {
    const record = await service.createIntent(intent());
    assert.throws(
      () => repo.save(
        { ...record, state: "FILLED", version: 2 },
        { transitionId: "bad", executionId: record.executionId, fromState: "INTENT_CREATED", toState: "FILLED", reasonCode: "bad", metadata: {}, createdAt: record.createdAt, sequence: 2 }
      ),
      /INVALID_EXECUTION_TRANSITION/
    );
    assert.throws(
      () => repo.save(
        { ...record, state: "QUEUED", version: 2 },
        { transitionId: "mismatch", executionId: record.executionId, fromState: "RISK_APPROVED", toState: "QUEUED", reasonCode: "bad", metadata: {}, createdAt: record.createdAt, sequence: 2 }
      ),
      /INVALID_EXECUTION_TRANSITION/
    );
  } finally { db.close(); }
});
