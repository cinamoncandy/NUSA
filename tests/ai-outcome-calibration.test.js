const test = require("node:test");
const assert = require("node:assert/strict");
const { OutcomeCalibrationLedger, computeCalibrationMetrics, createCalibrationOutcome, createCalibrationPrediction, verifyCalibrationOutcome, verifyCalibrationPrediction } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");

const digest = "a".repeat(64);
const calibrationHorizonMs = 5 * 60 * 1_000;
const calibrationResolutionGraceMs = 60_000;
const predictedAt = 1_000;
const dueAt = predictedAt + calibrationHorizonMs;
const cohort = Object.freeze({ providerId: "openai", modelVersionId: "model-v1", promptArtifactId: "nusa.ai.strategy_proposer", promptArtifactVersion: "1.0.0", promptArtifactDigest: digest, outcomeDefinitionId: "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M", outcomeDefinitionVersion: "1" });
const prediction = (id, rawProbability, provenance = "VERIFIED_RUNTIME", overrides = {}) => createCalibrationPrediction({ predictionId: id, orchestrationRunId: `run-${id}`, proposalId: `proposal-${id}`, agentId: "ai-strategy-proposer", role: "STRATEGY_PROPOSER", ...cohort, targetId: "KRW-BTC", anchorValue: 100, anchorObservedAt: 900, anchorEvidenceReference: `anchor-${id}`, rawProbability, predictedAt, horizonMs: calibrationHorizonMs, provenance, ...overrides });
const outcome = (predictionOrId, result, provenance = "VERIFIED_RUNTIME", overrides = {}) => {
  const linkedPrediction = typeof predictionOrId === "string" ? null : predictionOrId;
  const predictionId = linkedPrediction?.predictionId ?? predictionOrId;
  const predictionContentHash = overrides.predictionContentHash ?? linkedPrediction?.contentHash ?? "0".repeat(64);
  return createCalibrationOutcome({ predictionId, predictionContentHash, outcomeDefinitionId: cohort.outcomeDefinitionId, outcomeDefinitionVersion: cohort.outcomeDefinitionVersion, outcome: result, resolvedValue: result ? 101 : 99, resolvedAt: dueAt, evidenceReferences: [`evidence-${predictionId}`], provenance, ...overrides });
};

test("calibration rejects invalid probabilities and hash tampering", () => {
  for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => prediction(`bad-${String(value)}`, value), /within \[0,1\]/);
  const valid = prediction("p1", 0.7);
  assert.equal(verifyCalibrationPrediction(valid), true);
  assert.equal(verifyCalibrationPrediction({ ...valid, rawProbability: 0.8 }), false);
  assert.equal(verifyCalibrationPrediction({ ...valid, promptArtifactVersion: "2.0.0" }), false);
  assert.equal(verifyCalibrationPrediction({ ...valid, anchorValue: 101 }), false);
  assert.equal(verifyCalibrationPrediction({ ...valid, targetId: "KRW-ETH" }), false);
  assert.throws(() => prediction("future-anchor", 0.5, "VERIFIED_RUNTIME", { anchorObservedAt: predictedAt + 1 }), /cannot postdate prediction/);
  const resolved = outcome(valid, true);
  assert.equal(verifyCalibrationOutcome(resolved), true);
  assert.equal(verifyCalibrationOutcome({ ...resolved, outcome: false }), false);
  assert.equal(verifyCalibrationOutcome({ ...resolved, resolvedValue: 999 }), false);
  assert.equal(verifyCalibrationOutcome({ ...resolved, predictionContentHash: "f".repeat(64) }), false);
});

test("calibration ledger is idempotent but rejects conflicting replay, detached outcomes, and invalid resolution windows", () => {
  const ledger = new OutcomeCalibrationLedger();
  const first = prediction("p1", 0.7);
  assert.equal(ledger.appendPrediction(first), first);
  assert.equal(ledger.appendPrediction(first), first);
  assert.throws(() => ledger.appendPrediction(prediction("p1", 0.6)), /conflicting calibration prediction replay/);
  assert.throws(() => ledger.appendOutcome(outcome("missing", true)), /prediction is missing/);
  const other = prediction("other", 0.4);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "VERIFIED_RUNTIME", { predictionContentHash: other.contentHash })), /prediction hash mismatch/);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "VERIFIED_RUNTIME", { resolvedAt: dueAt - 1 })), /before horizon/);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "VERIFIED_RUNTIME", { resolvedAt: dueAt + calibrationResolutionGraceMs + 1 })), /stale for the resolution window/);
  const wrongHorizon = prediction("wrong-horizon", 0.7, "VERIFIED_RUNTIME", { horizonMs: 100 });
  ledger.appendPrediction(wrongHorizon);
  assert.throws(() => ledger.appendOutcome(outcome(wrongHorizon, true, "VERIFIED_RUNTIME", { resolvedAt: predictedAt + 100 })), /horizon does not match outcome definition/);
  const resolved = outcome(first, true);
  assert.equal(ledger.appendOutcome(resolved), resolved);
  assert.equal(ledger.appendOutcome(resolved), resolved);
  assert.throws(() => ledger.appendOutcome(outcome(first, false)), /conflicting calibration outcome replay/);
});

test("calibration outcome semantics fail closed when boolean and resolved value disagree or definition is unknown", () => {
  const ledger = new OutcomeCalibrationLedger();
  const first = prediction("semantic", 0.7);
  ledger.appendPrediction(first);
  assert.throws(() => ledger.appendOutcome(outcome(first, false, "VERIFIED_RUNTIME", { resolvedValue: 101 })), /does not match resolved value/);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "VERIFIED_RUNTIME", { resolvedValue: 99 })), /does not match resolved value/);

  const unknown = prediction("unknown-definition", 0.5, "VERIFIED_RUNTIME", { outcomeDefinitionId: "UNREGISTERED_OUTCOME" });
  ledger.appendPrediction(unknown);
  assert.throws(() => ledger.appendOutcome(outcome(unknown, true, "VERIFIED_RUNTIME", { outcomeDefinitionId: "UNREGISTERED_OUTCOME" })), /unsupported calibration outcome definition/);
});

test("reliability buckets include probability zero and one and compute weighted ECE and Brier", () => {
  const perfect = computeCalibrationMetrics([{ probability: 0, outcome: false }, { probability: 1, outcome: true }]);
  assert.equal(perfect.sampleCount, 2); assert.equal(perfect.expectedCalibrationError, 0); assert.equal(perfect.brierScore, 0); assert.equal(perfect.reliabilityBuckets[0].count, 1); assert.equal(perfect.reliabilityBuckets[9].count, 1);
  const known = computeCalibrationMetrics([{ probability: 0.25, outcome: true }, { probability: 0.25, outcome: false }], 2);
  assert.equal(known.expectedCalibrationError, 0.25); assert.equal(known.brierScore, 0.3125);
});

test("profiles are exact-cohort, insufficient by default, and synthetic observations cannot satisfy runtime evidence", () => {
  const ledger = new OutcomeCalibrationLedger();
  const synthetic = prediction("synthetic", 0.9, "SYNTHETIC_TEST"); ledger.appendPrediction(synthetic); ledger.appendOutcome(outcome(synthetic, true, "SYNTHETIC_TEST"));
  let profile = ledger.profile(cohort, 0.9, { minimumSamples: 1, minimumBucketSamples: 1 });
  assert.equal(profile.status, "INSUFFICIENT_DATA"); assert.equal(profile.sampleCount, 0); assert.equal(profile.effectiveConfidence, 0);
  const verified = prediction("verified", 0.8); ledger.appendPrediction(verified); ledger.appendOutcome(outcome(verified, true));
  for (const mismatch of [{ modelVersionId: "other-model" }, { promptArtifactId: "other-prompt" }, { promptArtifactVersion: "2.0.0" }, { promptArtifactDigest: "b".repeat(64) }]) {
    profile = ledger.profile({ ...cohort, ...mismatch }, 0.8, { minimumSamples: 1, minimumBucketSamples: 1 });
    assert.equal(profile.sampleCount, 0); assert.equal(profile.status, "INSUFFICIENT_DATA");
  }
});

test("global sample sufficiency cannot make a sparse target bucket trusted", () => {
  const ledger = new OutcomeCalibrationLedger();
  for (let index = 0; index < 20; index += 1) {
    const probability = index === 0 ? 0.85 : 0.15;
    const item = prediction(`sparse-${index}`, probability);
    ledger.appendPrediction(item);
    ledger.appendOutcome(outcome(item, probability > 0.5));
  }
  const sparse = ledger.profile(cohort, 0.85, { minimumSamples: 20, minimumBucketSamples: 5, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
  assert.equal(sparse.sampleCount, 20);
  assert.equal(sparse.status, "INSUFFICIENT_DATA");
  assert.equal(sparse.calibratedProbability, null);
  assert.equal(sparse.effectiveConfidence, 0);
});

test("calibrated confidence is conservative and degraded calibration cannot increase authority or confidence", () => {
  const good = new OutcomeCalibrationLedger();
  for (const id of ["a", "b"]) { const item = prediction(id, 0.8); good.appendPrediction(item); good.appendOutcome(outcome(item, true)); }
  const calibrated = good.profile(cohort, 0.8, { minimumSamples: 2, minimumBucketSamples: 2, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
  assert.equal(calibrated.status, "CALIBRATED"); assert.equal(calibrated.calibratedProbability, 1); assert.equal(calibrated.effectiveConfidence, 0.8); assert.equal(calibrated.liveAuthority, "NONE"); assert.equal(calibrated.productionMutationAllowed, false);
  const bad = new OutcomeCalibrationLedger();
  for (const id of ["c", "d"]) { const item = prediction(id, 0.9); bad.appendPrediction(item); bad.appendOutcome(outcome(item, false)); }
  const degraded = bad.profile(cohort, 0.9, { minimumSamples: 2, minimumBucketSamples: 2, maximumExpectedCalibrationError: 0.1, maximumBrierScore: 0.1 });
  assert.equal(degraded.status, "DEGRADED"); assert.equal(degraded.calibratedProbability, null); assert.equal(degraded.effectiveConfidence, 0); assert.equal(degraded.liveAuthority, "NONE"); assert.equal(degraded.productionMutationAllowed, false);
});

test("outcome definition and provenance mismatches fail closed", () => {
  const ledger = new OutcomeCalibrationLedger(); const first = prediction("p1", 0.5); ledger.appendPrediction(first);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "VERIFIED_RUNTIME", { outcomeDefinitionVersion: "2" })), /identity mismatch/);
  assert.throws(() => ledger.appendOutcome(outcome(first, true, "SYNTHETIC_TEST")), /provenance mismatch/);
});
