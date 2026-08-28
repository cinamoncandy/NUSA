import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperCalibrationEvidence, type PaperCalibrationObservation } from "./evolvePaperCalibrationEvidence";

const hash = "a".repeat(64);
const admission = (overrides: Partial<Parameters<typeof buildPaperCalibrationEvidence>[0]["admission"]> = {}) => ({
  candidateId: "candidate:alpha",
  datasetId: "dataset:paper",
  datasetContentSha256: hash,
  strength: "VERIFIED" as const,
  periodCount: 30,
  completedPeriodCount: 30,
  ...overrides,
});

const observations = (count = 30): PaperCalibrationObservation[] => Array.from({ length: count }, (_, index) => ({
  observationId: `paper-cal:${index}`,
  candidateId: "candidate:alpha",
  datasetId: "dataset:paper",
  datasetContentSha256: hash,
  regime: "TREND",
  predictedAt: index * 20 + 1,
  periodStartAt: index * 20 + 2,
  periodEndAt: index * 20 + 12,
  predictedPositiveNetReturnProbability: index % 2 === 0 ? 0.8 : 0.2,
  realizedNetReturn: index % 2 === 0 ? 0.01 : -0.01,
  status: "COMPLETED",
}));

test("summarizes verified point-in-time PAPER calibration without promoting confidence", () => {
  const result = buildPaperCalibrationEvidence({ admission: admission(), observations: observations() });
  assert.equal(result.strength, "VERIFIED");
  assert.equal(result.completedObservationCount, 30);
  assert.equal(result.realizedPositiveRate, 0.5);
  assert.equal(result.meanPredictedPositiveProbability, 0.5);
  assert.ok(result.brierScore != null && Math.abs(result.brierScore - 0.04) < 1e-12);
  assert.equal(result.confidenceIncreaseEligible, false);
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("INSUFFICIENT PAPER admission never becomes verified calibration", () => {
  const result = buildPaperCalibrationEvidence({
    admission: admission({ strength: "INSUFFICIENT" }),
    observations: observations(),
  });
  assert.equal(result.strength, "INSUFFICIENT");
  assert.equal(result.confidenceIncreaseEligible, false);
  assert.ok(result.reasons.includes("PAPER_ADMISSION_INSUFFICIENT"));
});

test("rejects future-derived prediction timestamps", () => {
  const values = observations();
  values[4] = { ...values[4]!, predictedAt: values[4]!.periodStartAt };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: values }),
    /EVOLVE_PAPER_CALIBRATION_LOOKAHEAD/,
  );
});

test("rejects candidate and dataset provenance mismatch", () => {
  const candidateMismatch = observations();
  candidateMismatch[3] = { ...candidateMismatch[3]!, candidateId: "candidate:other" };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: candidateMismatch }),
    /EVOLVE_PAPER_CALIBRATION_CANDIDATE_MISMATCH/,
  );

  const datasetMismatch = observations();
  datasetMismatch[3] = { ...datasetMismatch[3]!, datasetContentSha256: "b".repeat(64) };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: datasetMismatch }),
    /EVOLVE_PAPER_CALIBRATION_DATASET_MISMATCH/,
  );
});

test("rejects duplicate and overlapping observations", () => {
  const duplicate = observations();
  duplicate[5] = { ...duplicate[5]!, observationId: duplicate[4]!.observationId };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: duplicate }),
    /EVOLVE_PAPER_CALIBRATION_DUPLICATE_OBSERVATION/,
  );

  const overlap = observations();
  overlap[5] = {
    ...overlap[5]!,
    predictedAt: overlap[4]!.periodStartAt,
    periodStartAt: overlap[4]!.periodEndAt - 1,
  };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: overlap }),
    /EVOLVE_PAPER_CALIBRATION_CHRONOLOGY_INVALID/,
  );
});

test("retains rejected and halted periods while scoring only completed outcomes", () => {
  const values = observations();
  values[28] = { ...values[28]!, status: "REJECTED" };
  values[29] = { ...values[29]!, status: "HALTED" };
  const result = buildPaperCalibrationEvidence({
    admission: admission({ completedPeriodCount: 28 }),
    observations: values,
  });
  assert.equal(result.observationCount, 30);
  assert.equal(result.completedObservationCount, 28);
  assert.equal(result.rejectedOrHaltedObservationCount, 2);
  assert.ok(result.reasons.includes("REJECTED_OR_HALTED_PERIODS_RETAINED"));
});

test("rejects admission count drift instead of silently dropping evidence", () => {
  assert.throws(
    () => buildPaperCalibrationEvidence({
      admission: admission({ periodCount: 29, completedPeriodCount: 29 }),
      observations: observations(),
    }),
    /EVOLVE_PAPER_CALIBRATION_PERIOD_COUNT_MISMATCH/,
  );
});

test("rejects regime mixing so confidence cannot transfer across regimes", () => {
  const values = observations();
  values[10] = { ...values[10]!, regime: "MEAN_REVERSION" };
  assert.throws(
    () => buildPaperCalibrationEvidence({ admission: admission(), observations: values }),
    /EVOLVE_PAPER_CALIBRATION_REGIME_MIXED/,
  );
});
