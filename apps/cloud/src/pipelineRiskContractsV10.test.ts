import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import {
  bindRiskApprovalV10,
  buildSizedExecutionIntentV10
} from "./pipelineRiskContractsV10";

const requestHash = (request: PreTradeRiskRequest): string => createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");

function riskRequest(quantity: number): PreTradeRiskRequest {
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
    accountState: Object.freeze({ cash: 10_000_000, positionQuantity: 0, openOrderCount: 0 }),
    controlState: Object.freeze({ killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false }),
    approvalState: Object.freeze({ approved: true, expiresAt: 2_000, symbols: Object.freeze(["KRW-BTC"]) }),
    persistenceState: Object.freeze({ healthy: true }),
    reconciliationState: Object.freeze({ healthy: true, openP0: false }),
    deploymentState: Object.freeze({ integrityVerified: true }),
    rateState: Object.freeze({ ordersInLastSecond: 0, ordersInLastMinute: 0, sameSideStreak: 0 }),
    exposureState: Object.freeze({ symbolExposureNotional: 0, portfolioExposureNotional: 0, dailyBuyNotional: 0, dailySellNotional: 0 }),
    sessionState: Object.freeze({ dailyRealizedPnL: 0, consecutiveLossCount: 0, sessionPeakEquity: 10_000_000, sessionEquity: 10_000_000 })
  });
}

function allow(request: PreTradeRiskRequest): PreTradeRiskDecision {
  const requestSha256 = requestHash(request);
  return Object.freeze({
    status: "ALLOW",
    reasonCodes: Object.freeze([]),
    evaluatedAt: request.requestedAt,
    requestSha256,
    decisionSha256: createHash("sha256").update(JSON.stringify({ status: "ALLOW", reasonCodes: [], requestSha256 }), "utf8").digest("hex"),
    productionMutationAllowed: false
  });
}

describe("portfolio -> risk -> execution binding", () => {
  it("binds risk approval to the exact quantity produced by portfolio sizing", () => {
    const sized = buildSizedExecutionIntentV10(Object.freeze({
      decisionId: "decision-1",
      symbol: "KRW-BTC",
      side: "BUY",
      targetAllocation: 0.25,
      referencePrice: 100_000_000
    }), 0.025);
    const request = riskRequest(sized.quantity);
    const approved = bindRiskApprovalV10(sized, request, allow(request));
    assert.equal(approved.sizedIntent.quantity, 0.025);
    assert.equal(approved.riskDecision.status, "ALLOW");
    assert.equal(approved.productionMutationAllowed, false);
  });

  it("fails closed when quantity is increased after sizing but before execution", () => {
    const sized = buildSizedExecutionIntentV10(Object.freeze({
      decisionId: "decision-2",
      symbol: "KRW-BTC",
      side: "BUY",
      targetAllocation: 0.25,
      referencePrice: 100_000_000
    }), 0.025);
    const approvedRequest = riskRequest(0.025);
    const changedRequest = riskRequest(0.05);
    assert.throws(
      () => bindRiskApprovalV10(sized, changedRequest, allow(approvedRequest)),
      /not bound|exact sized quantity/
    );
  });

  it("fails closed when a risk request changes after the ALLOW decision", () => {
    const sized = buildSizedExecutionIntentV10(Object.freeze({
      decisionId: "decision-3",
      symbol: "KRW-BTC",
      side: "BUY",
      targetAllocation: 0.25,
      referencePrice: 100_000_000
    }), 0.025);
    const request = riskRequest(0.025);
    const decision = allow(request);
    const changed = { ...request, referencePrice: 99_000_000 } as PreTradeRiskRequest;
    assert.throws(() => bindRiskApprovalV10(sized, changed, decision), /not bound/);
  });
});
