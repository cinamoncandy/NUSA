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
    currentEvaluatorSemantics: {
      dataCostProvenanceId: "dataset-cost-v2",
      backtestExecutionSemanticsId: "next-open-v2",
      walkForwardWarmupSemanticsId: "pretest-warmup-v2",
    },
    repeatedFailureEvidence: [],
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

const failure = (id, searchId, overrides = {}) => ({
  evidenceId: id,
  candidateId: "candidate-865",
  strategyFamilyId: "family-865",
  canonicalSearchRunId: searchId,
  evaluatorSemantics: {
    dataCostProvenanceId: "dataset-cost-v2",
    backtestExecutionSemanticsId: "next-open-v2",
    walkForwardWarmupSemanticsId: "pretest-warmup-v2",
  },
  validity: "CURRENT",
  ...overrides,
});

test("three independent current comparable failures retire the strategy", () => {
  const failures = evaluateStrategyEvolutionAdvisory(withEvidence({
    repeatedFailureEvidence: [failure("failure-a", "search-a"), failure("failure-b", "search-b"), failure("failure-c", "search-c")],
  }, "DEMOTED"));
  assert.equal(failures.recommendation, "RETIRE");
  assert.ok(failures.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
});

test("structural domination can retire independently of lifecycle failure evidence", () => {
  const dominated = evaluateStrategyEvolutionAdvisory(withEvidence({ structurallyDominated: true }, "WATCH"));
  assert.equal(dominated.recommendation, "RETIRE");
});

test("legacy or superseded evaluator failures cannot retire a post-fix lifecycle decision", () => {
  const legacy = evaluateStrategyEvolutionAdvisory(withEvidence({
    repeatedFailureEvidence: [
      failure("legacy-a", "search-a", { validity: "REVALIDATION_REQUIRED", evaluatorSemantics: { dataCostProvenanceId: "dataset-cost-v1", backtestExecutionSemanticsId: "same-close-v1", walkForwardWarmupSemanticsId: "reset-v1" } }),
      failure("legacy-b", "search-b", { validity: "SUPERSEDED", evaluatorSemantics: { dataCostProvenanceId: "dataset-cost-v1", backtestExecutionSemanticsId: "same-close-v1", walkForwardWarmupSemanticsId: "reset-v1" } }),
      failure("legacy-c", "search-c", { validity: "REVALIDATION_REQUIRED", evaluatorSemantics: { dataCostProvenanceId: "dataset-cost-v1", backtestExecutionSemanticsId: "same-close-v1", walkForwardWarmupSemanticsId: "reset-v1" } }),
    ],
  }, "DEMOTED"));
  assert.equal(legacy.recommendation, "HOLD");
  assert.ok(legacy.reasons.includes("REPEATED_FAILURE_EVIDENCE_NOT_CURRENT"));
  assert.ok(!legacy.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
});

test("mixed, missing, or conflicting failure provenance fails closed to HOLD", () => {
  for (const failures of [
    [failure("current", "search-a"), failure("legacy", "search-b", { validity: "SUPERSEDED" })],
    [failure("missing", "search-a", { evaluatorSemantics: null })],
    [failure("conflict", "search-a", { validity: "CONFLICTING" })],
    [null],
  ]) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence({ repeatedFailureEvidence: failures }, "DEMOTED"));
    assert.equal(result.recommendation, "HOLD");
    assert.ok(result.reasons.includes("REPEATED_FAILURE_EVIDENCE_NOT_CURRENT"));
  }
});

test("replay and multiple cells in one canonical search count as one failure", () => {
  const result = evaluateStrategyEvolutionAdvisory(withEvidence({
    repeatedFailureEvidence: [
      failure("first-cell", "search-a"),
      failure("replay-of-first-cell", "search-a"),
      failure("second-cell", "search-a"),
    ],
  }, "DEMOTED"));
  assert.equal(result.recommendation, "PROMOTE");
  assert.ok(!result.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
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

test("learning explanation is deterministic and separates positive, counter, and missing evidence", () => {
  const patch = {
    costEvidence: "FAILED",
    regimeEvidence: "INSUFFICIENT",
    independentEvidenceCount: 2,
  };
  const first = evaluateStrategyEvolutionAdvisory(withEvidence(patch));
  const second = evaluateStrategyEvolutionAdvisory(withEvidence(patch));
  assert.deepEqual(first.explanation, second.explanation);
  assert.equal(first.explanation.promotionBlocked, true);
  assert.ok(first.explanation.positiveEvidence.includes("calibration:CALIBRATED"));
  assert.ok(first.explanation.counterEvidence.includes("cost:FAILED"));
  assert.ok(first.explanation.missingEvidence.includes("regime:INSUFFICIENT"));
  assert.match(first.explanation.summary, /Positive evidence:/);
  assert.match(first.explanation.summary, /Counter-evidence:/);
  assert.match(first.explanation.summary, /Missing evidence:/);
});

test("calibration identity and authority mismatches are rejected", () => {
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ regime: "RISK_OFF" }) })), /identity mismatch/);
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ liveAuthority: "FULL" }) })), /authority invariant/);
});
