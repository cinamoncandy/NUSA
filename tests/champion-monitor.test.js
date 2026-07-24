const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateChampion } = require("../dist/apps/cloud/src/championMonitor.js");

const policy = Object.freeze({
  policyVersion: "champion-monitor-v1",
  minimumEvidenceScore: 0.8,
  maximumCalibrationError: 0.08,
  maximumDrawdown: 0.15,
  maximumRiskBreaches: 0,
  orangeCapitalMultiplier: 0.5,
  yellowCapitalMultiplier: 0.8
});

const decay = Object.freeze({
  edgeId: "funding-carry",
  edgeVersion: "1.0.0",
  status: "GREEN",
  action: "MAINTAIN",
  decayScore: 0.05,
  confidence: 1,
  metrics: Object.freeze([]),
  reasons: Object.freeze([]),
  policyVersion: "edge-decay-v1",
  generatedAt: "2026-04-01T00:00:00.000Z"
});

const input = Object.freeze({
  reviewId: "review-001",
  strategyId: "funding-carry",
  strategyVersion: "1.0.0",
  lifecycle: "CHAMPION",
  generatedAt: "2026-04-01T00:01:00.000Z",
  edgeDecay: decay,
  evidenceScore: 0.92,
  calibrationError: 0.03,
  currentDrawdown: 0.06,
  riskBreachCount: 0,
  governanceApproved: true,
  activeCriticalIncident: false,
  currentCapitalFraction: 0.4,
  evidenceReferences: Object.freeze(["edge-decay:001", "paper:001"])
});

test("maintains a healthy champion without mutating state", () => {
  const result = evaluateChampion(input, policy);
  assert.equal(result.recommendation, "MAINTAIN");
  assert.equal(result.recommendedLifecycle, "CHAMPION");
  assert.equal(result.recommendedCapitalFraction, 0.4);
  assert.equal(result.requiresHumanApproval, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("reduces capital for orange decay", () => {
  const result = evaluateChampion({
    ...input,
    edgeDecay: { ...decay, status: "ORANGE", action: "REDUCE_CAPITAL", decayScore: 0.4 }
  }, policy);
  assert.equal(result.recommendation, "REDUCE_CAPITAL");
  assert.equal(result.recommendedCapitalFraction, 0.2);
});

test("recommends rollback to paper for red decay", () => {
  const result = evaluateChampion({
    ...input,
    edgeDecay: { ...decay, status: "RED", action: "SUSPEND", decayScore: 0.7 }
  }, policy);
  assert.equal(result.recommendation, "ROLLBACK_TO_PAPER");
  assert.equal(result.recommendedLifecycle, "PAPER");
  assert.equal(result.recommendedCapitalFraction, 0);
});

test("suspends on critical incident or governance failure", () => {
  const result = evaluateChampion({
    ...input,
    governanceApproved: false,
    activeCriticalIncident: true
  }, policy);
  assert.equal(result.recommendation, "SUSPEND");
  assert.equal(result.recommendedLifecycle, "SUSPENDED");
  assert.equal(result.recommendedCapitalFraction, 0);
});

test("does not promote non-champion lifecycle", () => {
  const result = evaluateChampion({ ...input, lifecycle: "PAPER" }, policy);
  assert.equal(result.recommendation, "OBSERVE");
  assert.equal(result.recommendedLifecycle, "PAPER");
  assert.equal(result.recommendedCapitalFraction, 0);
  assert.ok(result.reasons.includes("LIFECYCLE_NOT_CHAMPION"));
});

test("rejects mismatched edge identity and duplicate evidence", () => {
  assert.throws(() => evaluateChampion({
    ...input,
    edgeDecay: { ...decay, edgeId: "other" }
  }, policy), /does not match/);

  assert.throws(() => evaluateChampion({
    ...input,
    evidenceReferences: Object.freeze(["same", "same"])
  }, policy), /must be unique/);
});
