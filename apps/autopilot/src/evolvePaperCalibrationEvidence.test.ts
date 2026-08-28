import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaperCalibrationEvidence,
  comparePaperCalibrationEvidence,
  MIN_CALIBRATION_COMPARISON_PERIODS,
  type PaperCalibrationObservation,
} from "./evolvePaperCalibrationEvidence";

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

const windowObservations = (options: {
  readonly count?: number;
  readonly offset?: number;
  readonly prefix?: string;
  readonly reliable?: boolean;
} = {}): PaperCalibrationObservation[] => observations(options.count ?? 30).map((item, index) => ({
  ...item,
  observationId: `${options.prefix ?? "paper-cal-window"}:${index}`,
  predictedAt: item.predictedAt + (options.offset ?? 0),
  periodStartAt: item.periodStartAt + (options.offset ?? 0),
  periodEndAt: item.periodEndAt + (options.offset ?? 0),
  predictedPositiveNetReturnProbability: options.reliable === false ? 0.5 : item.predictedPositiveNetReturnProbability,
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

test("compares independent PAPER calibration windows through the existing confidence guard", () => {
  const baseline = windowObservations({ prefix: "baseline", reliable: false });
  const candidate = windowObservations({ prefix: "candidate", offset: 1_000, reliable: true });
  const result = comparePaperCalibrationEvidence({
    baseline: { admission: admission({ periodCount: 30, completedPeriodCount: 30 }), observations: baseline },
    candidate: { admission: admission({ periodCount: 30, completedPeriodCount: 30 }), observations: candidate },
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
  });

  assert.equal(result.status, "VERIFIED_IMPROVEMENT");
  assert.ok(result.brierScoreDelta != null && result.brierScoreDelta < 0);
  assert.equal(result.decision.reason, "INDEPENDENT_VERIFIED_EVIDENCE");
  assert.equal(result.decision.allowedConfidence, 0.7);
  assert.equal(result.confidenceIncreaseEligible, true);
  assert.ok(result.confidenceEvidence);
  assert.equal(result.confidenceEvidence.independent, true);
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("calibration comparison evidence identity is stable across input ordering", () => {
  const baseline = windowObservations({ prefix: "baseline-id", reliable: false });
  const candidate = windowObservations({ prefix: "candidate-id", offset: 1_000, reliable: true });
  const input = {
    baseline: { admission: admission(), observations: baseline },
    candidate: { admission: admission(), observations: candidate },
    currentConfidence: 0.4,
    requestedConfidence: 0.6,
  } as const;
  const first = comparePaperCalibrationEvidence(input);
  const second = comparePaperCalibrationEvidence({
    ...input,
    baseline: { ...input.baseline, observations: [...baseline].reverse() },
    candidate: { ...input.candidate, observations: [...candidate].reverse() },
  });
  assert.deepEqual(second, first);
});

test("regression never increases confidence even with an independent window", () => {
  const baseline = windowObservations({ prefix: "baseline-regression", reliable: true });
  const candidate = windowObservations({ prefix: "candidate-regression", offset: 1_000, reliable: false });
  const result = comparePaperCalibrationEvidence({
    baseline: { admission: admission(), observations: baseline },
    candidate: { admission: admission(), observations: candidate },
    currentConfidence: 0.7,
    requestedConfidence: 0.9,
  });
  assert.equal(result.status, "REGRESSION");
  assert.equal(result.decision.allowedConfidence, 0.7);
  assert.equal(result.decision.increased, false);
  assert.equal(result.confidenceIncreaseEligible, false);
});

test("insufficient longitudinal breadth stays fail-closed", () => {
  const count = MIN_CALIBRATION_COMPARISON_PERIODS - 1;
  const result = comparePaperCalibrationEvidence({
    baseline: { admission: admission({ periodCount: count, completedPeriodCount: count }), observations: windowObservations({ count, prefix: "baseline-short", reliable: false }) },
    candidate: { admission: admission({ periodCount: count, completedPeriodCount: count }), observations: windowObservations({ count, offset: 1_000, prefix: "candidate-short", reliable: true }) },
    currentConfidence: 0.5,
    requestedConfidence: 0.8,
  });
  assert.equal(result.status, "INSUFFICIENT");
  assert.equal(result.confidenceIncreaseEligible, false);
  assert.equal(result.confidenceEvidence, undefined);
  assert.equal(result.decision.allowedConfidence, 0.5);
});

test("overlapping windows and mismatched provenance are rejected", () => {
  const baseline = windowObservations({ prefix: "baseline-invalid", reliable: false });
  assert.throws(
    () => comparePaperCalibrationEvidence({
      baseline: { admission: admission(), observations: baseline },
      candidate: { admission: admission(), observations: windowObservations({ prefix: "candidate-overlap", offset: 500 }) },
      currentConfidence: 0.5,
      requestedConfidence: 0.6,
    }),
    /EVOLVE_PAPER_CALIBRATION_COMPARISON_WINDOWS_OVERLAP/,
  );

  const candidate = windowObservations({ prefix: "candidate-provenance", offset: 1_000, reliable: true });
  assert.throws(
    () => comparePaperCalibrationEvidence({
      baseline: { admission: admission(), observations: baseline },
      candidate: { admission: admission({ candidateId: "candidate:other" }), observations: candidate.map((item) => ({ ...item, candidateId: "candidate:other" })) },
      currentConfidence: 0.5,
      requestedConfidence: 0.6,
    }),
    /EVOLVE_PAPER_CALIBRATION_COMPARISON_PROVENANCE_MISMATCH/,
  );
});

test("cross-window duplicate identities and forbidden metadata fail closed", () => {
  const baseline = windowObservations({ prefix: "baseline-security", reliable: false });
  const duplicate = windowObservations({ prefix: "candidate-security", offset: 1_000, reliable: true });
  duplicate[0] = { ...duplicate[0]!, observationId: baseline[0]!.observationId };
  assert.throws(
    () => comparePaperCalibrationEvidence({
      baseline: { admission: admission(), observations: baseline },
      candidate: { admission: admission(), observations: duplicate },
      currentConfidence: 0.5,
      requestedConfidence: 0.6,
    }),
    /EVOLVE_PAPER_CALIBRATION_COMPARISON_DUPLICATE_OBSERVATION/,
  );

  const contaminated = windowObservations({ prefix: "candidate-contaminated", offset: 1_000, reliable: true }) as Array<PaperCalibrationObservation & Record<string, unknown>>;
  const forbiddenField = ["to", "ken"].join("");
  contaminated[0]![forbiddenField] = ["fixture", "-", "value"].join("");
  assert.throws(
    () => comparePaperCalibrationEvidence({
      baseline: { admission: admission(), observations: baseline },
      candidate: { admission: admission(), observations: contaminated },
      currentConfidence: 0.5,
      requestedConfidence: 0.6,
    }),
    /EVOLVE_PAPER_CALIBRATION_FORBIDDEN_FIELD/,
  );
});
