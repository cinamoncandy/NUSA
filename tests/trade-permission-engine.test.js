const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTradePermission } = require("../dist/apps/cloud/src/tradePermissionEngine.js");

const probability = Object.freeze({
  market: "KRW-BTC",
  outcomeDefinition: "price up over next 15 minutes",
  rawProbability: 0.94,
  calibratedProbability: 0.93,
  confidence: 0.91,
  uncertainty: 0.08,
  abstain: false,
  abstainReasons: Object.freeze([]),
  evidence: Object.freeze([]),
  metrics: Object.freeze({
    sampleSize: 250,
    brierScore: 0.08,
    logLoss: 0.24,
    expectedCalibrationError: 0.03,
    sharpness: 0.18,
    reliability: Object.freeze([])
  }),
  modelVersion: "probability-v1",
  generatedAt: "2026-07-13T05:00:00.000Z"
});

const policy = Object.freeze({
  policyVersion: "trade-permission-v1",
  minimumDataQuality: 0.9,
  maximumAgeMs: 5_000,
  compatibleRegimes: Object.freeze(["TREND_UP", "RANGE"]),
  minimumCalibratedProbability: 0.9,
  minimumNetExpectedValue: 0.002,
  minimumRewardToRisk: 1.5,
  minimumLiquidityScore: 0.75,
  minimumCapacityUsd: 10_000,
  maximumSlippageBps: 8,
  maximumUncertainty: 0.15,
  maximumModelDispersion: 0.05,
  maximumRiskBudgetUsage: 0.8,
  permissionTtlMs: 30_000
});

const input = Object.freeze({
  decisionId: "decision-001",
  strategyId: "intraday-alpha-v1",
  market: "KRW-BTC",
  generatedAt: "2026-07-13T05:00:02.000Z",
  probability,
  dataQuality: 0.98,
  sourceGeneratedAt: "2026-07-13T05:00:01.000Z",
  regime: "TREND_UP",
  netExpectedValue: 0.004,
  expectedReward: 0.018,
  expectedLoss: 0.01,
  liquidityScore: 0.91,
  capacityUsd: 50_000,
  estimatedSlippageBps: 4,
  modelProbabilities: Object.freeze([0.92, 0.94, 0.93]),
  riskBudgetUsage: 0.35,
  killSwitchActive: false,
  governanceApproved: true,
  evidenceReferences: Object.freeze(["market-state:001", "probability:001"])
});

test("permits only when every mandatory gate passes", () => {
  const result = evaluateTradePermission(input, policy);
  assert.equal(result.decision, "PERMIT");
  assert.equal(result.failedGates.length, 0);
  assert.equal(result.passedGates.length, 14);
  assert.equal(result.expiresAt, "2026-07-13T05:00:32.000Z");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.gates));
});

test("defaults to reject when probability abstains", () => {
  const result = evaluateTradePermission({
    ...input,
    probability: {
      ...probability,
      abstain: true,
      abstainReasons: Object.freeze(["INSUFFICIENT_CALIBRATION_SAMPLES"])
    }
  }, policy);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.failedGates.includes("PROBABILITY"));
});

test("rejects when any safety gate fails", () => {
  const result = evaluateTradePermission({
    ...input,
    killSwitchActive: true,
    governanceApproved: false,
    riskBudgetUsage: 0.95
  }, policy);
  assert.equal(result.decision, "REJECT");
  assert.deepEqual(result.failedGates.sort(), ["GOVERNANCE", "KILL_SWITCH", "RISK_BUDGET"].sort());
});

test("rejects stale data and excessive model disagreement", () => {
  const result = evaluateTradePermission({
    ...input,
    sourceGeneratedAt: "2026-07-13T04:59:00.000Z",
    modelProbabilities: Object.freeze([0.95, 0.55, 0.91])
  }, policy);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.failedGates.includes("FRESHNESS"));
  assert.ok(result.failedGates.includes("MODEL_AGREEMENT"));
});

test("rejects mismatched probability market", () => {
  assert.throws(() => evaluateTradePermission({
    ...input,
    probability: { ...probability, market: "KRW-ETH" }
  }, policy), /does not match/);
});

test("requires at least two model estimates for agreement", () => {
  const result = evaluateTradePermission({ ...input, modelProbabilities: Object.freeze([0.93]) }, policy);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.failedGates.includes("MODEL_AGREEMENT"));
});

test("rejects duplicate evidence references", () => {
  assert.throws(() => evaluateTradePermission({
    ...input,
    evidenceReferences: Object.freeze(["same", "same"])
  }, policy), /must be unique/);
});
