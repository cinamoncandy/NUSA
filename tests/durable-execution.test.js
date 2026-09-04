const test = require("node:test");
const assert = require("node:assert/strict");
const { ExecutionService, InMemoryExecutionRepository, DisabledExchangeExecutionPort, FakeExchangeExecutionPort, LiveMutationDisabledError, allowedExecutionTransitions } = require("../dist/apps/execution/src/durable-execution.js");

const intent = (overrides = {}) => ({ strategyId: "strategy-1", signalId: "signal-1", market: "KRW-BTC", side: "BUY", orderType: "MARKET", requestedQuantity: "2.5", ...overrides });

test("execution lifecycle persists transitions and blocks live mutation by default", async () => {
  const repo = new InMemoryExecutionRepository();
  const service = new ExecutionService(repo, new DisabledExchangeExecutionPort());
  let record = await service.createIntent(intent({ createdAt: "2026-07-30T00:00:00.000Z" }));
  record = await service.approveRisk(record.executionId, "risk-1");
  record = await service.queue(record.executionId);
  await assert.rejects(() => service.submit(record.executionId), LiveMutationDisabledError);
  assert.equal(repo.get(record.executionId).state, "QUEUED");
  assert.equal(repo.get(record.executionId).riskDecisionId, "risk-1");
  assert.equal(repo.transitions(record.executionId).length, 3);
  assert.equal(new DisabledExchangeExecutionPort().productionMutationAllowed, false);
});

test("risk approve and reject persist the decision binding in a single transition", async () => {
  const repo = new InMemoryExecutionRepository();
  const service = new ExecutionService(repo, new DisabledExchangeExecutionPort());
  let approved = await service.createIntent(intent());
  approved = await service.approveRisk(approved.executionId, "risk-9");
  assert.equal(approved.riskDecisionId, "risk-9");
  assert.equal(repo.get(approved.executionId).riskDecisionId, "risk-9");
  assert.equal(repo.transitions(approved.executionId).length, 2);
  let rejected = await service.createIntent(intent());
  rejected = await service.rejectRisk(rejected.executionId, "risk-10", "RISK_LIMIT");
  assert.equal(rejected.state, "RISK_REJECTED");
  assert.equal(rejected.riskDecisionId, "risk-10");
  const reloaded = repo.get(rejected.executionId);
  assert.equal(reloaded.state, "RISK_REJECTED");
  assert.equal(reloaded.riskDecisionId, "risk-10");
  assert.equal(repo.transitions(rejected.executionId).length, 2);
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

test("fills in different decimal scales still complete", async () => {
  const port = new FakeExchangeExecutionPort({ status: "ACCEPTED", exchangeOrderId: "order-9" });
  const repo = new InMemoryExecutionRepository();
  const service = new ExecutionService(repo, port, true);
  let record = await service.createIntent(intent({ requestedQuantity: "2.5" }));
  record = await service.approveRisk(record.executionId, "risk-9");
  record = await service.queue(record.executionId);
  record = await service.submit(record.executionId);
  assert.equal(record.state, "ACCEPTED");
  const partial = await service.addFill({ fillId: "fill-1", executionId: record.executionId, exchangeTradeId: "trade-1", quantity: "1.50", price: "100", fee: null, feeCurrency: null, executedAt: record.createdAt });
  assert.equal(partial.state, "PARTIALLY_FILLED");
  const filled = await service.addFill({ fillId: "fill-2", executionId: record.executionId, exchangeTradeId: "trade-2", quantity: "1.0", price: "100", fee: null, feeCurrency: null, executedAt: record.createdAt });
  assert.equal(filled.state, "FILLED");
  assert.equal(filled.filledQuantity, "2.50");
});

test("transition table includes reconciliation and unknown-submission recovery without resubmission", () => {
  const table = allowedExecutionTransitions();
  assert.deepEqual(table.SUBMISSION_UNKNOWN, ["ACCEPTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "RECONCILIATION_REQUIRED"]);
  assert.ok(table.RECONCILIATION_REQUIRED.includes("RECONCILED"));
  assert.ok(!table.SUBMISSION_UNKNOWN.includes("SUBMITTING"));
});

test("fake adapter covers accepted, reject, and partial fill without production capability", async () => {
  const acceptedPort = new FakeExchangeExecutionPort({ status: "ACCEPTED", exchangeOrderId: "order-1" });
  const repo = new InMemoryExecutionRepository(); const service = new ExecutionService(repo, acceptedPort, true);
  let record = await service.createIntent(intent({ requestedQuantity: "2" })); record = await service.approveRisk(record.executionId, "risk-1"); record = await service.queue(record.executionId); record = await service.submit(record.executionId);
  assert.equal(record.state, "ACCEPTED"); assert.equal(acceptedPort.submitCalls, 1);
  const partial = await service.addFill({ fillId: "fill-1", executionId: record.executionId, exchangeTradeId: "trade-1", quantity: "1", price: "100", fee: "1", feeCurrency: "KRW", executedAt: record.createdAt });
  assert.equal(partial.state, "PARTIALLY_FILLED");
  const rejected = new FakeExchangeExecutionPort({ status: "REJECTED", reasonCode: "EXCHANGE_REJECTED" }); const second = new InMemoryExecutionRepository(); const other = new ExecutionService(second, rejected, true); let rejectedRecord = await other.createIntent(intent()); rejectedRecord = await other.approveRisk(rejectedRecord.executionId, "risk-2"); rejectedRecord = await other.queue(rejectedRecord.executionId); rejectedRecord = await other.submit(rejectedRecord.executionId); assert.equal(rejectedRecord.state, "REJECTED");
});

test("cancel lifecycle, restart replay, duplicate ACK, and out-of-order events remain fail closed", async () => {
  const port = new FakeExchangeExecutionPort({ status: "ACCEPTED", exchangeOrderId: "order-2" }); const repo = new InMemoryExecutionRepository(); const service = new ExecutionService(repo, port, true); let record = await service.createIntent(intent()); record = await service.approveRisk(record.executionId, "risk-3"); record = await service.queue(record.executionId); record = await service.submit(record.executionId); record = await service.requestCancel(record.executionId); record = await service.cancel(record.executionId); assert.equal(record.state, "CANCELED"); assert.equal(port.cancelCalls, 1); assert.throws(() => repo.save({ ...record, state: "ACCEPTED", version: record.version + 1 }, { transitionId: "dup", executionId: record.executionId, fromState: "CANCELED", toState: "ACCEPTED", reasonCode: "duplicate", metadata: {}, createdAt: record.updatedAt, sequence: repo.transitions(record.executionId).length + 1 }), /INVALID_EXECUTION_TRANSITION/); assert.deepEqual(await service.replayRecovery(), []);
});
