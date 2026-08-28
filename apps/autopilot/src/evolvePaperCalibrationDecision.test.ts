import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaperCalibrationEvidence,
  comparePaperCalibrationEvidence,
  type PaperCalibrationObservation,
} from "./evolvePaperCalibrationEvidence";
import { projectPaperCalibrationLearningDecision } from "./evolvePaperCalibrationDecision";

const hash = "a".repeat(64);
const admission = () => ({
  candidateId: "candidate:calibration",
  datasetId: "dataset:paper",
  datasetContentSha256: hash,
  strength: "VERIFIED" as const,
  periodCount: 30,
  completedPeriodCount: 30,
});

function observations(prefix: string, offset: number, probability: number): PaperCalibrationObservation[] {
  return Array.from({ length: 30 }, (_, index) => {
    const start = offset + index * 10 + 2;
    return {
      observationId: `${prefix}:${index}`,
      candidateId: "candidate:calibration",
      datasetId: "dataset:paper",
      datasetContentSha256: hash,
      regime: "TREND",
      predictedAt: start - 1,
      periodStartAt: start,
      periodEndAt: start + 5,
      predictedPositiveNetReturnProbability: probability,
      realizedNetReturn: 0.01,
      status: "COMPLETED",
    };
  });
}

test("calibration regression deterministically requires DEMOTE and removes calibration eligibility", () => {
  const comparison = comparePaperCalibrationEvidence({
    baseline: { admission: admission(), observations: observations("baseline-regression", 0, 0.9) },
    candidate: { admission: admission(), observations: observations("candidate-regression", 1_000, 0.5) },
    currentConfidence: 0.7,
    requestedConfidence: 0.9,
  });
  assert.equal(comparison.status, "REGRESSION");

  const decision = projectPaperCalibrationLearningDecision(comparison);
  assert.equal(decision.action, "DEMOTE");
  assert.equal(decision.calibrationEligible, false);
  assert.equal(decision.confidenceIncreaseEligible, false);
  assert.ok(decision.reasons.includes("CALIBRATION_REGRESSION_REQUIRES_ELIGIBILITY_REDUCTION"));
});

test("verified improvement is eligible only when the existing confidence guard actually allows increase", () => {
  const comparison = comparePaperCalibrationEvidence({
    baseline: { admission: admission(), observations: observations("baseline-improvement", 0, 0.5) },
    candidate: { admission: admission(), observations: observations("candidate-improvement", 1_000, 0.9) },
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
  });
  assert.equal(comparison.status, "VERIFIED_IMPROVEMENT");

  const decision = projectPaperCalibrationLearningDecision(comparison);
  assert.equal(decision.action, "CONFIDENCE_INCREASE_ELIGIBLE");
  assert.equal(decision.calibrationEligible, true);
  assert.equal(decision.confidenceIncreaseEligible, true);
  assert.deepEqual(decision.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("insufficient comparison can only HOLD and never manufacture confidence", () => {
  const summary = buildPaperCalibrationEvidence({
    admission: { ...admission(), strength: "INSUFFICIENT" },
    observations: observations("insufficient", 0, 0.9),
  });
  assert.equal(summary.strength, "INSUFFICIENT");

  const comparison = comparePaperCalibrationEvidence({
    baseline: { admission: { ...admission(), strength: "INSUFFICIENT" }, observations: observations("baseline-insufficient", 0, 0.5) },
    candidate: { admission: admission(), observations: observations("candidate-insufficient", 1_000, 0.9) },
    currentConfidence: 0.5,
    requestedConfidence: 0.8,
  });
  assert.equal(comparison.status, "INSUFFICIENT");

  const decision = projectPaperCalibrationLearningDecision(comparison);
  assert.equal(decision.action, "HOLD");
  assert.equal(decision.calibrationEligible, false);
  assert.equal(decision.confidenceIncreaseEligible, false);
});
