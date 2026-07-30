const test = require("node:test");
const assert = require("node:assert/strict");
const { ExecutionService, InMemoryExecutionRepository, DisabledExchangeExecutionPort, LiveMutationDisabledError, allowedExecutionTransitions } = require("../dist/apps/execution/src/durable-execution.js");

const intent = (overrides = {}) => ({ strategyId: "strategy-1", signalId: "signal-1", market: "KRW-BTC", side: "BUY", orderType: "MARKET", requestedQuantity: "2.5", ...overrides });

test("execution lifecycle persists transitions and blocks live mutation by default", async () => {
  const repo = new InMemoryExecutionRepository();
  const service = new ExecutionService(repo, new DisabledExchangeExecutionPort());
  let record = await service.createIntent(intent({ createdAt: "2026-07-30T00:00:00.000Z" }));
  record = await service.approveRisk(record.executionId, "risk-1");
  record = await service.queue(record.executionId);
  await assert.rejects(() => service.submit(record.executionId), LiveMutationDisabledError);
  assert.equal(repo.get(record.executionId).state, "QUEUED");
  assert.equal(repo.transitions(record.executionId).length, 4);
  assert.equal(new DisabledExchangeExecutionPort().productionMutationAllowed, false);
});

test("invalid transitions and duplicate fill events fail closed", async () => {
  const repo = new InMemoryExecutionRepository();
  const service = new ExecutionService(repo);
  let record = await service.createIntent(intent());
  assert.throws(() => repo.save({ ...record, state: "FILLED", version: 2 }, { transitionId: "bad", executionId: record.executionId, fromState: "INTENT_CREATED", toState: "FILLED", reasonCode: "bad", metadata: {}, createdAt: record.createdAt, sequence: 2 }), /INVALID_EXECUTION_TRANSITION/);
  record = await service.approveRisk(record.executionId, "risk-1");
  record = await service.queue(record.executionId);
  record = await repo.save({ ...record, state: "SUBMITTING", version: record.version + 1, submittedAt: record.createdAt }, { transitionId: "t-submit", executionId: record.executionId, fromState: "QUEUED", toState: "SUBMITTING", reasonCode: "test", metadata: {}, createdAt: record.createdAt, sequence: repo.transitions(record.executionId).length + 1 });
  record = await repo.save({ ...record, state: "ACCEPTED", version: record.version + 1, acceptedAt: record.createdAt }, { transitionId: "t-accepted", executionId: record.executionId, fromState: "SUBMITTING", toState: "ACCEPTED", reasonCode: "test", metadata: {}, createdAt: record.createdAt, sequence: repo.transitions(record.executionId).length + 1 });
  const fill = { fillId: "fill-1", executionId: record.executionId, exchangeTradeId: "trade-1", quantity: "1", price: "100", fee: null, feeCurrency: null, executedAt: record.createdAt };
  await service.addFill(fill);
  await service.addFill({ ...fill, fillId: "fill-duplicate" });
  assert.equal(repo.fills(record.executionId).length, 1);
});

test("transition table includes reconciliation and unknown-submission recovery without resubmission", () => {
  const table = allowedExecutionTransitions();
  assert.deepEqual(table.SUBMISSION_UNKNOWN, ["ACCEPTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "RECONCILIATION_REQUIRED"]);
  assert.ok(table.RECONCILIATION_REQUIRED.includes("RECONCILED"));
  assert.ok(!table.SUBMISSION_UNKNOWN.includes("SUBMITTING"));
});
