import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PreTradeRiskDecision } from "../../../packages/contracts/src/riskGateway";
import { RiskEnforcingPaperExecutionPort, runExecutionEngineV10 } from "./executionEngineV10";
import { PaperTradingExecutionLoop, type PaperExecutionTick } from "./paperTradingExecutionLoop";

const HASH = "a".repeat(64);

function risk(status: PreTradeRiskDecision["status"]): PreTradeRiskDecision {
  return Object.freeze({
    status,
    reasonCodes: Object.freeze(status === "ALLOW" ? [] : ["MAX_ORDER_NOTIONAL"]),
    evaluatedAt: 1_000,
    requestSha256: HASH,
    decisionSha256: HASH,
    productionMutationAllowed: false
  });
}

function tick(): PaperExecutionTick {
  return Object.freeze({
    now: 1_000,
    market: "KRW-BTC",
    price: 100_000_000,
    observedAt: 1_000,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: Object.freeze([])
  });
}

describe("10X-S execution risk boundary", () => {
  it("blocks a risk-rejected tick before the raw execution loop", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const result = runExecutionEngineV10({ port, approved: { tick: tick(), riskDecision: risk("REJECT") } });
    assert.equal(result.riskBoundaryEnforced, true);
    assert.equal(result.result.status, "BLOCKED");
    assert.equal(result.result.reason, "LEVEL10_EXECUTION_RISK_REJECT");
    assert.equal(result.result.orders.length, 0);
  });

  it("allows only an independently risk-approved PAPER tick to reach processing", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
    const port = new RiskEnforcingPaperExecutionPort(loop);
    const result = runExecutionEngineV10({ port, approved: { tick: tick(), riskDecision: risk("ALLOW") } });
    assert.equal(result.riskBoundaryEnforced, true);
    assert.equal(result.result.status, "WAIT");
    assert.equal(result.result.reason, "no actionable paper decision");
  });
});
