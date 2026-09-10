"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { MODULE_STAGE_ORDER } = require("../dist/apps/cloud/src/moduleLevel10.js");
const { createDefaultPlatformTopology } = require("../dist/apps/cloud/src/platformTopology.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

/**
 * This repository carries two canonical module maps, and they disagree.
 *
 *   platformTopology.ts:  MARKET > PROBABILITY > ALPHA > PORTFOLIO > RISK > EXECUTION > RUNTIME
 *   moduleLevel10.ts:     MARKET_DATA > INTELLIGENCE > STRATEGY > DECISION > RISK > PORTFOLIO >
 *                         EXECUTION > PAPER_ADAPTER > REVIEW > MEMORY
 *
 * Both freeze their order and both throw if it "changed unexpectedly", so each is defended
 * against drift on its own while contradicting the other about where risk sits. The
 * disagreement is not cosmetic: sizing before gating means risk judges the order that will
 * actually be sent, and gating before sizing means it judges an intent whose quantity is
 * decided afterwards.
 *
 * The running system answers this today, and it answers with the older map:
 * `cloudPaperExecutionBoundary` computes `quantity` from the decision's allocation and the
 * operator's investment percent, then passes that quantity into `riskGate.evaluate`. The V10
 * order is not wired to anything (see `pipelineWiringV10.ts`), so nothing is broken right now --
 * but wiring the V10 orchestrator as declared would move the gate to before sizing and quietly
 * change what risk is allowed to see.
 *
 * These tests do not pick a winner; that is an owner's decision, not a test's. They keep the
 * disagreement from being resolved by accident in either direction, and they pin the behavior
 * the live path currently depends on.
 */

const indexOfStage = (order, name) => order.findIndex((stage) => stage.toUpperCase().startsWith(name));

test("the two canonical maps still disagree about where risk sits, and neither moved on its own", () => {
  const topology = createDefaultPlatformTopology().corePipeline;
  const v10 = MODULE_STAGE_ORDER;

  assert.ok(indexOfStage(topology, "PORTFOLIO") < indexOfStage(topology, "RISK"), "platformTopology sizes before it gates");
  assert.ok(indexOfStage(v10, "RISK") < indexOfStage(v10, "PORTFOLIO"), "moduleLevel10 gates before it sizes");

  // If this fails, one of the two maps was changed. That is allowed -- it may even be the
  // resolution this repository needs -- but it must be a decision someone made on purpose, with
  // the execution boundary below moved to match, not a rename that slipped through.
  assert.deepEqual([...topology], ["MARKET", "PROBABILITY", "ALPHA", "PORTFOLIO", "RISK", "EXECUTION", "RUNTIME"]);
  assert.deepEqual(
    [...v10],
    ["MARKET_DATA", "INTELLIGENCE", "STRATEGY", "DECISION", "RISK", "PORTFOLIO", "EXECUTION", "PAPER_ADAPTER", "REVIEW", "MEMORY"]
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
