"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { MODULE_STAGE_ORDER } = require("../dist/apps/cloud/src/moduleLevel10.js");
const { createDefaultPlatformTopology } = require("../dist/apps/cloud/src/platformTopology.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

/**
 * This repository carried two canonical module maps that disagreed about where risk sits:
 *
 *   platformTopology.ts:  MARKET > PROBABILITY > ALPHA > PORTFOLIO > RISK > EXECUTION > RUNTIME
 *   moduleLevel10.ts:     ... > DECISION > RISK > PORTFOLIO > EXECUTION > ...
 *
 * Each froze its own order and threw if that order "changed unexpectedly", so both were defended
 * against drift in isolation while contradicting each other, and nothing compared them.
 *
 * The disagreement was not cosmetic. Sizing before gating means risk judges the order that will
 * actually be sent; gating before sizing means it judges an intent whose quantity is decided
 * afterwards, and a limit expressed in notional cannot bind at all. The running system already
 * answered it: `cloudPaperExecutionBoundary` computes `quantity` from the decision's allocation
 * and the operator's investment percent, then hands that quantity to `riskGate.evaluate`. The
 * repository's own rule that risk may "reject, resize, pause, or halt any intent" points the same
 * way -- resizing presupposes a size.
 *
 * The owner resolved it toward the running behavior, and `MODULE_STAGE_ORDER` now places
 * PORTFOLIO before RISK. These tests keep the two maps agreeing from here on, and pin the
 * behavior that makes the ordering mean something.
 */

const indexOfStage = (order, name) => order.findIndex((stage) => stage.toUpperCase().startsWith(name));

test("the two canonical maps agree about where risk sits", () => {
  const topology = createDefaultPlatformTopology().corePipeline;
  const v10 = MODULE_STAGE_ORDER;

  assert.ok(indexOfStage(topology, "PORTFOLIO") < indexOfStage(topology, "RISK"), "platformTopology must size before it gates");
  assert.ok(
    indexOfStage(v10, "PORTFOLIO") < indexOfStage(v10, "RISK"),
    "moduleLevel10 gates before it sizes again -- risk would judge an intent with no quantity, " +
      "and the notional limits below could not bind"
  );

  // Both maps are frozen and each throws on unexpected reordering, so a change here is always
  // deliberate. It must stay deliberate on both sides at once, together with the execution
  // boundary that implements it.
  assert.deepEqual([...topology], ["MARKET", "PROBABILITY", "ALPHA", "PORTFOLIO", "RISK", "EXECUTION", "RUNTIME"]);
  assert.deepEqual(
    [...v10],
    ["MARKET_DATA", "INTELLIGENCE", "STRATEGY", "DECISION", "PORTFOLIO", "RISK", "EXECUTION", "PAPER_ADAPTER", "REVIEW", "MEMORY"]
  );
});

const binding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "sma-5-20",
  datasetId: "fixture-dataset",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 500,
  periodStartAt: 900,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
  candidateStrategy: Object.freeze({
    candidateId: "sma-5-20",
    familyId: "sma-crossover",
    lineageId: "fixture-lineage",
    specificationHash: "d".repeat(64),
    codeSha: "e".repeat(40),
    costModelVersion: "fixture-cost-v1",
    parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 })
  })
});

const tickWith = (allocation) => Object.freeze({
  now: 2_000,
  market: "KRW-BTC",
  price: 50_000_000,
  observedAt: 1_500,
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  decisions: Object.freeze([Object.freeze({
    symbol: "KRW-BTC",
    action: "BUY",
    confidence: 1,
    risk: "LOW",
    allocation,
    leverage: 1,
    score: 1,
    reasons: Object.freeze(["fixture"]),
    decidedAt: 1_000,
    paperCandidateBinding: binding,
    paperCandidateStrategyDecision: Object.freeze({ action: "BUY", score: 1, confidence: 1, reason: "SMA_CROSSOVER:5/20:fixture", observedAt: 950 })
  })])
});

function capturedRiskRequest(allocation) {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const seen = [];
  const riskGate = {
    evaluate(requestValue) {
      seen.push(requestValue);
      return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) });
    }
  };
  new CloudPaperExecutionBoundary({ loop, riskGate, readP0State: () => ({ openP0: false }) }).processTick(tickWith(allocation));
  assert.equal(seen.length, 1);
  return seen[0];
}

test("risk gates the sized order, not an unsized intent", () => {
  const request = capturedRiskRequest(0.1);
  assert.ok(Number.isFinite(request.quantity) && request.quantity > 0, "risk received no quantity to judge");
  assert.equal(request.price, 50_000_000);
  assert.equal(request.side, "BUY");
});

test("the quantity risk sees moves with the allocation that produced it", () => {
  // The property that makes the ordering matter: were the gate ahead of sizing, these would be
  // indistinguishable to risk, and a limit expressed in notional could not bind at all.
  const small = capturedRiskRequest(0.05).quantity;
  const large = capturedRiskRequest(0.2).quantity;
  assert.ok(large > small, `allocation did not reach risk: ${small} vs ${large}`);
  assert.equal(Number((large / small).toFixed(6)), 4);
});
