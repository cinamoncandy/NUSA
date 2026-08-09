const test = require("node:test");
const assert = require("node:assert/strict");
const { OutcomeCalibrationLedger, computeCalibrationMetrics, createCalibrationOutcome, createCalibrationPrediction, verifyCalibrationOutcome, verifyCalibrationPrediction } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");

const digest = "a".repeat(64);
const cohort = Object.freeze({ providerId: "openai", modelVersionId: "model-v1", promptArtifactId: "nusa.ai.strategy_proposer", promptArtifactVersion: "1.0.0", promptArtifactDigest: digest, outcomeDefinitionId: "next-period-positive", outcomeDefinitionVersion: "1" });
const prediction = (id, rawProbability, provenance = "VERIFIED_RUNTIME", overrides = {}) => createCalibrationPrediction({ predictionId: id, orchestrationRunId: `run-${id}`, proposalId: `proposal-${id}`, agentId: "ai-strategy-proposer", role: "STRATEGY_PROPOSER", ...cohort, rawProbability, predictedAt: 1_000, horizonMs: 100, provenance, ...overrides });
const outcome = (predictionId, result, provenance = "VERIFIED_RUNTIME", overrides = {}) => createCalibrationOutcome({ predictionId, outcomeDefinitionId: cohort.outcomeDefinitionId, outcomeDefinitionVersion: cohort.outcomeDefinitionVersion, outcome: result, resolvedAt: 1_100, evidenceReferences: [`evidence-${predictionId}`], provenance, ...overrides });

test("calibration rejects invalid probabilities and hash tampering", () => {
  for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => prediction(`bad-${String(value)}`, value), /within \[0,1\]/);
  const valid = prediction("p1", 0.7);
  assert.equal(verifyCalibrationPrediction(valid), true);
  assert.equal(verifyCalibrationPrediction({ ...valid, rawProbability: 0.8 }), false);
  assert.equal(verifyCalibrationPrediction({ ...valid, promptArtifactVersion: "2.0.0" }), false);
  const resolved = outcome("p1", true);
  assert.equal(verifyCalibrationOutcome(resolved), true);
  assert.equal(verifyCalibrationOutcome({ ...resolved, outcome: false }), false);
});

test("calibration ledger is idempotent but rejects conflicting replay and premature outcomes", () => {
  const ledger = new OutcomeCalibrationLedger();
  const first = prediction("p1", 0.7);
  assert.equal(ledger.appendPrediction(first), first);
  assert.equal(ledger.appendPrediction(first), first);
  assert.throws(() => ledger.appendPrediction(prediction("p1", 0.6)), /conflicting calibration prediction replay/);
  assert.throws(() => ledger.appendOutcome(outcome("missing", true)), /prediction is missing/);
  assert.throws(() => ledger.appendOutcome(outcome("p1", true, "VERIFIED_RUNTIME", { resolvedAt: 1_099 })), /before horizon/);
  const resolved = outcome("p1", true);
  assert.equal(ledger.appendOutcome(resolved), resolved);
  assert.equal(ledger.appendOutcome(resolved), resolved);
  assert.throws(() => ledger.appendOutcome(outcome("p1", false)), /conflicting calibration outcome replay/);
});

test("reliability buckets include probability zero and one and compute weighted ECE and Brier", () => {
  const perfect = computeCalibrationMetrics([{ probability: 0, outcome: false }, { probability: 1, outcome: true }]);
  assert.equal(perfect.sampleCount, 2); assert.equal(perfect.expectedCalibrationError, 0); assert.equal(perfect.brierScore, 0); assert.equal(perfect.reliabilityBuckets[0].count, 1); assert.equal(perfect.reliabilityBuckets[9].count, 1);
  const known = computeCalibrationMetrics([{ probability: 0.25, outcome: true }, { probability: 0.25, outcome: false }], 2);
  assert.equal(known.expectedCalibrationError, 0.25); assert.equal(known.brierScore, 0.3125);
});

test("profiles are exact-cohort, insufficient by default, and synthetic observations cannot satisfy runtime evidence", () => {
  const ledger = new OutcomeCalibrationLedger();
  const synthetic = prediction("synthetic", 0.9, "SYNTHETIC_TEST"); ledger.appendPrediction(synthetic); ledger.appendOutcome(outcome("synthetic", true, "SYNTHETIC_TEST"));
  let profile = ledger.profile(cohort, 0.9, { minimumSamples: 1 });
  assert.equal(profile.status, "INSUFFICIENT_DATA"); assert.equal(profile.sampleCount, 0); assert.equal(profile.effectiveConfidence, 0);
  const verified = prediction("verified", 0.8); ledger.appendPrediction(verified); ledger.appendOutcome(outcome("verified", true));
  for (const mismatch of [{ modelVersionId: "other-model" }, { promptArtifactId: "other-prompt" }, { promptArtifactVersion: "2.0.0" }, { promptArtifactDigest: "b".repeat(64) }]) {
    profile = ledger.profile({ ...cohort, ...mismatch }, 0.8, { minimumSamples: 1 });
    assert.equal(profile.sampleCount, 0); assert.equal(profile.status, "INSUFFICIENT_DATA");
  }
});

test("calibrated confidence is conservative and degraded calibration cannot increase authority or confidence", () => {
  const good = new OutcomeCalibrationLedger();
  for (const id of ["a", "b"]) { good.appendPrediction(prediction(id, 0.8)); good.appendOutcome(outcome(id, true)); }
  const calibrated = good.profile(cohort, 0.8, { minimumSamples: 2, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
  assert.equal(calibrated.status, "CALIBRATED"); assert.equal(calibrated.calibratedProbability, 1); assert.equal(calibrated.effectiveConfidence, 0.8); assert.equal(calibrated.liveAuthority, "NONE"); assert.equal(calibrated.productionMutationAllowed, false);
  const bad = new OutcomeCalibrationLedger();
  for (const id of ["c", "d"]) { bad.appendPrediction(prediction(id, 0.9)); bad.appendOutcome(outcome(id, false)); }
  const degraded = bad.profile(cohort, 0.9, { minimumSamples: 2, maximumExpectedCalibrationError: 0.1, maximumBrierScore: 0.1 });
  assert.equal(degraded.status, "DEGRADED"); assert.equal(degraded.calibratedProbability, null); assert.equal(degraded.effectiveConfidence, 0); assert.equal(degraded.liveAuthority, "NONE"); assert.equal(degraded.productionMutationAllowed, false);
});

test("outcome definition and provenance mismatches fail closed", () => {
  const ledger = new OutcomeCalibrationLedger(); ledger.appendPrediction(prediction("p1", 0.5));
  assert.throws(() => ledger.appendOutcome(outcome("p1", true, "VERIFIED_RUNTIME", { outcomeDefinitionVersion: "2" })), /identity mismatch/);
  assert.throws(() => ledger.appendOutcome(outcome("p1", true, "SYNTHETIC_TEST")), /provenance mismatch/);
});
