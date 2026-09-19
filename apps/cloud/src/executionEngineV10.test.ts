import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import { RiskEnforcingPaperExecutionPort, runExecutionEngineV10 } from "./executionEngineV10";
import { PaperTradingExecutionLoop, type PaperExecutionTick } from "./paperTradingExecutionLoop";

const HASH = "a".repeat(64);
const requestSha256 = (request: PreTradeRiskRequest): string => createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");

function request(quantity = 0.005): PreTradeRiskRequest {
  return Object.freeze({
    schemaVersion: 1,
    requestId: "risk-1",
    signalId: "signal-1",
    commandId: "command-1",
    clientOrderId: "client-1",
    strategyFingerprint: "strategy",
    configFingerprint: "config",
    runtimeFingerprint: "runtime",
    riskPolicyFingerprint: "risk-policy",
    symbol: "KRW-BTC",
    side: "BUY",
    quantity,
    referencePrice: 100_000_000,
    requestedAt: 1_000,
    marketDataState: Object.freeze({ status: "HEALTHY", price: 100_000_000 }),
    accountState: Object.freeze({ cash: 1_000_000, positionQuantity: 0, openOrderCount: 0 }),
    controlState: Object.freeze({ killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false }),
    approvalState: Object.freeze({ approved: true, expiresAt: 2_000, symbols: Object.freeze(["KRW-BTC"]) }),
    persistenceState: Object.freeze({ healthy: true }),
    reconciliationState: Object.freeze({ healthy: true, openP0: false }),
    deploymentState: Object.freeze({ integrityVerified: true }),
    rateState: Object.freeze({ ordersInLastSecond: 0, ordersInLastMinute: 0, sameSideStreak: 0 }),
    exposureState: Object.freeze({ symbolExposureNotional: 0, portfolioExposureNotional: 0, dailyBuyNotional: 0, dailySellNotional: 0 }),
    sessionState: Object.freeze({ dailyRealizedPnL: 0, consecutiveLossCount: 0, sessionPeakEquity: 1_000_000, sessionEquity: 1_000_000 })
  });
}

function risk(status: PreTradeRiskDecision["status"], riskRequest: PreTradeRiskRequest): PreTradeRiskDecision {
  const reasonCodes: PreTradeRiskDecision["reasonCodes"] = status === "ALLOW" ? [] : ["MAX_ORDER_NOTIONAL"];
  return Object.freeze({
    status,
    reasonCodes: Object.freeze(reasonCodes),
    evaluatedAt: 1_000,
    requestSha256: requestSha256(riskRequest),
    decisionSha256: HASH,
    productionMutationAllowed: false
  });
}

function tick(quantity = 0.005): PaperExecutionTick {
  return Object.freeze({
    now: 1_000,
    market: "KRW-BTC",
    price: 100_000_000,
    quantity,
    observedAt: 1_000,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: Object.freeze([Object.freeze({
      symbol: "KRW-BTC",
      action: "BUY" as const,
      confidence: 0.8,
      risk: "LOW" as const,
      allocation: 0.5,
      leverage: 1,
      score: 0.8,
      reasons: Object.freeze(["test sized intent"]),
      decidedAt: 1_000
    })])
  });
}

describe("10X-S execution risk boundary", () => {
  it("blocks a risk-rejected tick before the raw execution loop", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const riskRequest = request();
    const result = runExecutionEngineV10({ port, approved: { tick: tick(), riskRequest, riskDecision: risk("REJECT", riskRequest) } });
    assert.equal(result.riskBoundaryEnforced, true);
    assert.equal(result.result.status, "BLOCKED");
    assert.equal(result.result.reason, "LEVEL10_EXECUTION_RISK_REJECT");
    assert.equal(result.result.orders.length, 0);
  });

  it("lets an exact risk-bound PAPER sized intent reach the underlying processor", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const riskRequest = request();
    const result = runExecutionEngineV10({ port, approved: { tick: tick(), riskRequest, riskDecision: risk("ALLOW", riskRequest) } });
    assert.equal(result.riskBoundaryEnforced, true);
    assert.notEqual(result.result.reason, "LEVEL10_EXECUTION_RISK_REQUEST_BINDING_MISMATCH");
    assert.notEqual(result.result.reason, "LEVEL10_EXECUTION_SIZED_INTENT_MISMATCH");
  });

  it("blocks quantity changes made after risk approval", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const riskRequest = request(0.005);
    const result = runExecutionEngineV10({ port, approved: { tick: tick(0.01), riskRequest, riskDecision: risk("ALLOW", riskRequest) } });
    assert.equal(result.result.status, "BLOCKED");
    assert.equal(result.result.reason, "LEVEL10_EXECUTION_SIZED_INTENT_MISMATCH");
  });

  it("blocks a risk request mutated after its ALLOW decision", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const approvedRequest = request(0.005);
    const mutatedRequest = Object.freeze({ ...approvedRequest, quantity: 0.01 });
    const result = runExecutionEngineV10({ port, approved: { tick: tick(0.01), riskRequest: mutatedRequest, riskDecision: risk("ALLOW", approvedRequest) } });
    assert.equal(result.result.status, "BLOCKED");
    assert.equal(result.result.reason, "LEVEL10_EXECUTION_RISK_REQUEST_BINDING_MISMATCH");
  });
});
