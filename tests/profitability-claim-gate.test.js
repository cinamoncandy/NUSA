const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateProfitabilityClaim } = require("../dist/apps/cloud/src/profitabilityClaimGate.js");

const evidence = (overrides = {}) => ({
  evaluatedAt: 1_000,
  operationalCompletionStatus: "READY_FOR_OWNER_REVIEW",
  outOfSampleClosedTrades: 30,
  paperClosedTrades: 50,
  outOfSampleExpectancy: 1,
  outOfSampleProfitFactor: 1.2,
  paperNetProfit: 1,
  paperProfitFactor: 1.2,
  markedMaximumDrawdown: 0.1,
  doubledCostReturn: 0,
  monteCarloRuinProbability: 0.02,
  benchmarkOutperformance: 0.01,
  datasetSha256: "a".repeat(64),
  scenarioEvidenceSha256: "b".repeat(64),
  ...overrides
});

test("allows only a bounded evidence statement after every hard gate passes", () => {
  const result = evaluateProfitabilityClaim(evidence());
  assert.equal(result.status, "ELIGIBLE_FOR_LIMITED_CLAIM");
  assert.match(result.allowedClaim, /does not guarantee future profit/);
  assert.equal(result.guaranteedProfitClaimAllowed, false);
  assert.equal(result.liveReadinessImplied, false);
  assert.equal(result.ownerApprovalRequired, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("operational incompleteness blocks any profitability claim", () => {
  const result = evaluateProfitabilityClaim(evidence({ operationalCompletionStatus: "WAITING_FOR_EVIDENCE" }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.allowedClaim, null);
  assert.ok(result.reasons.includes("OPERATIONAL_COMPLETION_NOT_READY"));
});

test("weak OOS, Paper, stress, ruin, drawdown and benchmark evidence stays insufficient", () => {
  const result = evaluateProfitabilityClaim(evidence({
    outOfSampleClosedTrades: 29,
    paperClosedTrades: 49,
    outOfSampleExpectancy: 0,
    outOfSampleProfitFactor: 1.19,
    paperNetProfit: 0,
    paperProfitFactor: 1.19,
    markedMaximumDrawdown: 0.11,
    doubledCostReturn: -0.01,
    monteCarloRuinProbability: 0.021,
    benchmarkOutperformance: 0
  }));
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.allowedClaim, null);
  assert.equal(result.reasons.length, 9);
});

test("invalid provenance and metrics fail closed", () => {
  assert.throws(() => evaluateProfitabilityClaim(evidence({ datasetSha256: "bad" })), /SHA-256/);
  assert.throws(() => evaluateProfitabilityClaim(evidence({ scenarioEvidenceSha256: "A".repeat(64) })), /SHA-256/);
  assert.throws(() => evaluateProfitabilityClaim(evidence({ markedMaximumDrawdown: 1.1 })), /between 0 and 1/);
  assert.throws(() => evaluateProfitabilityClaim(evidence({ monteCarloRuinProbability: Number.NaN })), /finite/);
});

test("profitability claim replay is deterministic", () => {
  assert.deepEqual(evaluateProfitabilityClaim(evidence()), evaluateProfitabilityClaim(evidence()));
});
