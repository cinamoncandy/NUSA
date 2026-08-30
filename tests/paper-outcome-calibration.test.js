const test = require("node:test");
const assert = require("node:assert/strict");
const { calibratePaperOutcomes } = require("../dist/apps/cloud/src/paperOutcomeCalibration.js");

const evaluatedAt = "2026-08-30T08:00:00.000Z";
const observation = (index, overrides = {}) => ({
  periodId: `period-${index}`,
  candidateId: "candidate-865",
  strategyFamilyId: "family-865",
  regime: "RISK_ON",
  predictedSuccessProbability: 0.6,
  expectedNetEdge: 0.01,
  realizedNetReturn: 0.012,
  realizedSuccess: true,
  observedAt: `2026-08-30T0${index}:00:00.000Z`,
  outcomeFingerprintSha256: index.toString(16).padStart(64, "0"),
  evidenceStatus: "VERIFIED",
  source: "PAPER",
  independentEvidenceId: `independent-${index}`,
  ...overrides,
});

const input = (overrides = {}) => ({
  calibrationId: "calibration-865",
  candidateId: "candidate-865",
  strategyFamilyId: "family-865",
  regime: "RISK_ON",
  evaluatedAt,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  minimumVerifiedPeriods: 3,
  overconfidenceTolerance: 0.1,
  priorIndependentEvidenceCount: 2,
  observations: [observation(1), observation(2), observation(3)],
  ...overrides,
});

test("calibrates verified independent PAPER outcomes deterministically", () => {
  const result = calibratePaperOutcomes(input());
  assert.equal(result.decision, "CALIBRATED");
  assert.equal(result.confidenceAction, "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE");
  assert.equal(result.verifiedPeriods, 3);
  assert.equal(result.independentEvidenceCount, 3);
  assert.equal(result.empiricalSuccessRate, 1);
  assert.equal(result.meanPredictedSuccessProbability, 0.6);
  assert.equal(result.brierScore, 0.16);
  assert.equal(result.calibrationGap, -0.4);
  assert.match(result.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("overconfidence or edge disappointment can only reduce confidence", () => {
  const overconfident = [1, 2, 3].map((index) => observation(index, {
    predictedSuccessProbability: 0.9,
    expectedNetEdge: 0.03,
    realizedSuccess: index === 1,
    realizedNetReturn: index === 1 ? 0.005 : -0.01,
  }));
  const result = calibratePaperOutcomes(input({ observations: overconfident }));
  assert.equal(result.decision, "CALIBRATED");
  assert.equal(result.confidenceAction, "REDUCE");
  assert.ok(result.calibrationGap > 0.1);
});

test("selection or replay cannot manufacture independent calibration evidence", () => {
  const first = observation(1);
  const duplicatePeriod = observation(2, { periodId: first.periodId });
  const duplicateFingerprint = observation(3, { outcomeFingerprintSha256: first.outcomeFingerprintSha256 });
  const result = calibratePaperOutcomes(input({ observations: [first, duplicatePeriod, duplicateFingerprint] }));
  assert.equal(result.decision, "ABSTAIN");
  assert.equal(result.confidenceAction, "HOLD");
  assert.ok(result.reasons.includes("DUPLICATE_OR_REPLAYED_OUTCOME"));
});

test("reusing one evidence source cannot count as independent evidence breadth", () => {
  const observations = [1, 2, 3].map((index) => observation(index, { independentEvidenceId: "same-selection-source" }));
  const result = calibratePaperOutcomes(input({ observations }));
  assert.equal(result.decision, "ABSTAIN");
  assert.equal(result.confidenceAction, "HOLD");
  assert.ok(result.reasons.includes("NON_INDEPENDENT_EVIDENCE_REUSE"));
});

test("future stale unverified mismatched candidate and cross-regime evidence fail closed", () => {
  const cases = [
    [observation(1, { observedAt: "2026-08-30T09:00:00.000Z" }), "FUTURE_EVIDENCE"],
    [observation(1, { observedAt: "2026-08-28T00:00:00.000Z" }), "STALE_EVIDENCE"],
    [observation(1, { evidenceStatus: "UNKNOWN" }), "EVIDENCE_UNKNOWN"],
    [observation(1, { candidateId: "other" }), "CANDIDATE_IDENTITY_MISMATCH"],
    [observation(1, { regime: "RISK_OFF" }), "REGIME_EVIDENCE_MISMATCH"],
  ];
  for (const [bad, reason] of cases) {
    const result = calibratePaperOutcomes(input({ observations: [bad, observation(2), observation(3)] }));
    assert.equal(result.decision, "ABSTAIN");
    assert.equal(result.confidenceAction, "HOLD");
    assert.ok(result.reasons.includes(reason));
  }
});

test("confidence cannot rise without newly independent verified evidence", () => {
  const result = calibratePaperOutcomes(input({ priorIndependentEvidenceCount: 3 }));
  assert.equal(result.decision, "CALIBRATED");
  assert.equal(result.confidenceAction, "HOLD");
});

test("insufficient longitudinal evidence never becomes calibration confidence", () => {
  const result = calibratePaperOutcomes(input({ observations: [observation(1), observation(2)] }));
  assert.equal(result.decision, "ABSTAIN");
  assert.equal(result.confidenceAction, "HOLD");
  assert.ok(result.reasons.includes("INSUFFICIENT_LONGITUDINAL_PAPER_EVIDENCE"));
  assert.equal(result.evidenceFingerprintSha256, null);
});

test("invalid numeric and provenance inputs fail before decisioning", () => {
  assert.throws(() => calibratePaperOutcomes(input({ observations: [observation(1, { predictedSuccessProbability: 1.1 })] })), /between 0 and 1/);
  assert.throws(() => calibratePaperOutcomes(input({ observations: [observation(1, { expectedNetEdge: Number.NaN })] })), /finite/);
  assert.throws(() => calibratePaperOutcomes(input({ observations: [observation(1, { outcomeFingerprintSha256: "bad" })] })), /sha256/);
  assert.throws(() => calibratePaperOutcomes(input({ overconfidenceTolerance: -0.1 })), /between 0 and 1/);
});
