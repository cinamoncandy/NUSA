const test = require("node:test");
const assert = require("node:assert/strict");
const { ExecutionService, InMemoryExecutionRepository, FakeExchangeExecutionPort } = require("../dist/apps/execution/src/durable-execution.js");
const { GlobalRiskGateway } = require("../dist/apps/execution/src/global-risk-gateway.js");
const { submitAfterGlobalRisk } = require("../dist/apps/execution/src/execution-risk-orchestrator.js");

const policy = { policyVersion: "risk-v1", maxGlobalExposure: "100", maxDailyLoss: "10", maxPositionSize: "50", maxPositionCount: 5, maxStrategyExposure: "80", maxSymbolExposure: "70", maxConsecutiveLosses: 3 };
const context = (overrides = {}) => ({ exchange: "UPBIT", strategyId: "s1", symbol: "KRW-BTC", sessionId: "session-1", currentPosition: "0", openOrderExposure: "0", partialFillExposure: "0", expectedFillExposure: "10", realizedPnl: "0", unrealizedPnl: "0", positionCount: 0, strategyExposure: "0", symbolExposure: "0", consecutiveLosses: 0, unknownExecutionCount: 0, reconciliationStatus: "MATCH", marketData: "HEALTHY", credentialStatus: "READY", recoveryStatus: "COMPLETE", manualApprovalToken: "approval", productionMutationAllowed: false, killSwitches: [], ...overrides });
const intent = { strategyId: "s1", signalId: "sig-1", market: "KRW-BTC", side: "BUY", orderType: "MARKET", requestedQuantity: "2" };

test("blocked global risk returns before the exchange port is called", async () => {
  const port = new FakeExchangeExecutionPort({ status: "ACCEPTED", exchangeOrderId: "exchange-1" });
  const service = new ExecutionService(new InMemoryExecutionRepository(), port, true);
  let record = await service.createIntent(intent); record = await service.approveRisk(record.executionId, "risk-1"); await service.queue(record.executionId);
  const result = await submitAfterGlobalRisk(service, new GlobalRiskGateway(policy), record.executionId, context({ marketData: "STALE" }));
  assert.equal(result.decision.result, "BLOCKED"); assert.equal(result.execution, null); assert.equal(port.submitCalls, 0);
});

test("approved global risk is the only path that reaches submit", async () => {
  const port = new FakeExchangeExecutionPort({ status: "ACCEPTED", exchangeOrderId: "exchange-2" });
  const service = new ExecutionService(new InMemoryExecutionRepository(), port, true);
  let record = await service.createIntent(intent); record = await service.approveRisk(record.executionId, "risk-2"); await service.queue(record.executionId);
  const result = await submitAfterGlobalRisk(service, new GlobalRiskGateway(policy), record.executionId, context());
  assert.equal(result.decision.result, "APPROVED"); assert.equal(result.execution.state, "ACCEPTED"); assert.equal(port.submitCalls, 1);
});
