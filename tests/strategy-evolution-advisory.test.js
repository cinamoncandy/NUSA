const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStrategyEvolutionAdvisory } = require("../dist/apps/cloud/src/strategyEvolutionAdvisory.js");

const calibration = (overrides = {}) => ({
  calibrationId: "cal-865",
  decision: "CALIBRATED",
  confidenceAction: "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE",
  reasons: [],
  candidateId: "candidate-865",
  strategyFamilyId: "family-865",
  regime: "RISK_ON",
  verifiedPeriods: 30,
  independentEvidenceCount: 5,
  empiricalSuccessRate: 0.6,
  meanPredictedSuccessProbability: 0.58,
  brierScore: 0.2,
  meanExpectedNetEdge: 0.01,
  meanRealizedNetReturn: 0.012,
  calibrationGap: -0.02,
  evidenceFingerprintSha256: "a".repeat(64),
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  ...overrides,
});

const input = (overrides = {}) => ({
  advisoryId: "evolve-865",
  currentState: "WATCH",
  evidence: {
    candidateId: "candidate-865",
    strategyFamilyId: "family-865",
    regime: "RISK_ON",
    calibration: calibration(),
    regimeEvidence: "VERIFIED",
    costEvidence: "VERIFIED",
    drawdownEvidence: "VERIFIED",
    provenanceEvidence: "VERIFIED",
    infrastructureEvidence: "VERIFIED",
    repeatedFailureCount: 0,
    structurallyDominated: false,
    independentEvidenceCount: 5,
    minimumIndependentEvidenceForPromotion: 4,
  },
  ...overrides,
});

const withEvidence = (patch, currentState = "WATCH") => {
  const base = input();
  return { ...base, currentState, evidence: { ...base.evidence, ...patch } };
};

test("promotion is recommendation-only and requires new independent verified evidence", () => {
  const result = evaluateStrategyEvolutionAdvisory(input());
  assert.equal(result.recommendation, "PROMOTE");
  assert.equal(result.recommendedState, "PROMOTED");
  assert.ok(result.reasons.includes("INDEPENDENT_VERIFIED_EVIDENCE_SUPPORTS_PROMOTION_RECOMMENDATION"));
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("promoted strategy is demoted on calibration regime cost or drawdown deterioration", () => {
  const cases = [
    [{ calibration: calibration({ confidenceAction: "REDUCE" }) }, "CALIBRATION_DETERIORATION"],
    [{ regimeEvidence: "FAILED" }, "REGIME_DEGRADATION"],
    [{ costEvidence: "FAILED" }, "COST_EROSION"],
    [{ drawdownEvidence: "FAILED" }, "DRAWDOWN_DETERIORATION"],
  ];
  for (const [patch, reason] of cases) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence(patch, "PROMOTED"));
    assert.equal(result.recommendation, "DEMOTE");
    assert.equal(result.recommendedState, "DEMOTED");
    assert.ok(result.reasons.includes(reason));
  }
});

test("provenance or infrastructure failure quarantines before performance interpretation", () => {
  for (const patch of [{ provenanceEvidence: "FAILED" }, { infrastructureEvidence: "FAILED" }]) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence(patch, "PROMOTED"));
    assert.equal(result.recommendation, "QUARANTINE");
    assert.equal(result.recommendedState, "QUARANTINED");
  }
});

test("insufficient stale or conflicting evidence fails closed", () => {
  for (const status of ["INSUFFICIENT", "STALE", "CONFLICTING"]) {
    const promoted = evaluateStrategyEvolutionAdvisory(withEvidence({ regimeEvidence: status }, "PROMOTED"));
    assert.equal(promoted.recommendation, "DEMOTE");
    assert.ok(promoted.reasons.includes("EVIDENCE_UNCERTAIN_FAIL_CLOSED"));
    const watch = evaluateStrategyEvolutionAdvisory(withEvidence({ costEvidence: status }, "WATCH"));
    assert.equal(watch.recommendation, "HOLD");
  }
});

test("repeated independent failures or structural domination retire the strategy", () => {
  const failures = evaluateStrategyEvolutionAdvisory(withEvidence({ repeatedFailureCount: 3 }, "DEMOTED"));
  assert.equal(failures.recommendation, "RETIRE");
  const dominated = evaluateStrategyEvolutionAdvisory(withEvidence({ structurallyDominated: true }, "WATCH"));
  assert.equal(dominated.recommendation, "RETIRE");
});

test("retired state is terminal and never self-revives", () => {
  const result = evaluateStrategyEvolutionAdvisory({ ...input(), currentState: "RETIRED" });
  assert.equal(result.recommendation, "HOLD");
  assert.equal(result.recommendedState, "RETIRED");
  assert.ok(result.reasons.includes("RETIRED_IS_TERMINAL"));
});

test("promotion is blocked without enough independent evidence or calibration permission", () => {
  const narrow = evaluateStrategyEvolutionAdvisory(withEvidence({ independentEvidenceCount: 3 }));
  assert.equal(narrow.recommendation, "HOLD");
  const heldCalibration = evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ confidenceAction: "HOLD" }) }));
  assert.equal(heldCalibration.recommendation, "HOLD");
});

test("calibration identity and authority mismatches are rejected", () => {
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ regime: "RISK_OFF" }) })), /identity mismatch/);
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ liveAuthority: "FULL" }) })), /authority invariant/);
});
