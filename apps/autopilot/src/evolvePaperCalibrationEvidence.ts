export type PaperCalibrationEvidenceStrength = "VERIFIED" | "INSUFFICIENT";
export type PaperCalibrationPeriodStatus = "COMPLETED" | "REJECTED" | "HALTED";

export interface PaperCalibrationObservation {
  readonly observationId: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly regime: string;
  readonly predictedAt: number;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly predictedPositiveNetReturnProbability: number;
  readonly realizedNetReturn: number;
  readonly status: PaperCalibrationPeriodStatus;
}

export interface PaperCalibrationAdmissionBinding {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly strength: PaperCalibrationEvidenceStrength;
  readonly periodCount: number;
  readonly completedPeriodCount: number;
}

export interface PaperCalibrationEvidenceSummary {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly regime: string;
  readonly strength: PaperCalibrationEvidenceStrength;
  readonly observationCount: number;
  readonly completedObservationCount: number;
  readonly rejectedOrHaltedObservationCount: number;
  readonly meanPredictedPositiveProbability: number | null;
  readonly realizedPositiveRate: number | null;
  readonly brierScore: number | null;
  readonly confidenceIncreaseEligible: false;
  readonly reasons: readonly string[];
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const boundedProbability = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function normalizedIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || !ID.test(normalized)) throw new Error(`EVOLVE_PAPER_CALIBRATION_${field}_INVALID`);
  return normalized;
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("EVOLVE_PAPER_CALIBRATION_TIMESTAMP_INVALID");
}

/**
 * Builds a point-in-time PAPER calibration evidence summary without turning calibration into
 * confidence. The predicted probability must have existed before the realized period, and the
 * exact candidate/dataset provenance must match the already-admitted PAPER evidence.
 *
 * This is intentionally an evidence boundary, not a promotion rule. Even VERIFIED calibration
 * evidence is never confidence-increase eligible by itself; a later comparison must demonstrate
 * a verified improvement against an independent baseline through the existing confidence guard.
 */
export function buildPaperCalibrationEvidence(input: {
  readonly admission: PaperCalibrationAdmissionBinding;
  readonly observations: readonly PaperCalibrationObservation[];
}): PaperCalibrationEvidenceSummary {
  const admissionCandidateId = normalizedIdentifier(input.admission.candidateId, "CANDIDATE_ID");
  const admissionDatasetId = normalizedIdentifier(input.admission.datasetId, "DATASET_ID");
  if (!SHA256.test(input.admission.datasetContentSha256)) throw new Error("EVOLVE_PAPER_CALIBRATION_DATASET_HASH_INVALID");
  if (!Number.isSafeInteger(input.admission.periodCount) || input.admission.periodCount < 1) throw new Error("EVOLVE_PAPER_CALIBRATION_ADMISSION_COUNT_INVALID");
  if (!Number.isSafeInteger(input.admission.completedPeriodCount) || input.admission.completedPeriodCount < 0 || input.admission.completedPeriodCount > input.admission.periodCount) {
    throw new Error("EVOLVE_PAPER_CALIBRATION_ADMISSION_COUNT_INVALID");
  }
  if (input.observations.length === 0) throw new Error("EVOLVE_PAPER_CALIBRATION_EMPTY");
  if (input.observations.length !== input.admission.periodCount) throw new Error("EVOLVE_PAPER_CALIBRATION_PERIOD_COUNT_MISMATCH");

  const ordered = [...input.observations].sort((left, right) => left.periodStartAt - right.periodStartAt || left.observationId.localeCompare(right.observationId));
  const seen = new Set<string>();
  let regime: string | undefined;
  let previousEndAt: number | undefined;
  let completed = 0;
  let rejectedOrHalted = 0;
  let predictedSum = 0;
  let realizedPositive = 0;
  let squaredError = 0;

  for (const observation of ordered) {
    const observationId = normalizedIdentifier(observation.observationId, "OBSERVATION_ID");
    if (seen.has(observationId)) throw new Error("EVOLVE_PAPER_CALIBRATION_DUPLICATE_OBSERVATION");
    seen.add(observationId);

    if (normalizedIdentifier(observation.candidateId, "CANDIDATE_ID") !== admissionCandidateId) throw new Error("EVOLVE_PAPER_CALIBRATION_CANDIDATE_MISMATCH");
    if (normalizedIdentifier(observation.datasetId, "DATASET_ID") !== admissionDatasetId || observation.datasetContentSha256 !== input.admission.datasetContentSha256) {
      throw new Error("EVOLVE_PAPER_CALIBRATION_DATASET_MISMATCH");
    }
    if (!SHA256.test(observation.datasetContentSha256)) throw new Error("EVOLVE_PAPER_CALIBRATION_DATASET_HASH_INVALID");

    const observationRegime = normalizedIdentifier(observation.regime, "REGIME");
    if (regime == null) regime = observationRegime;
    if (observationRegime !== regime) throw new Error("EVOLVE_PAPER_CALIBRATION_REGIME_MIXED");

    validateTimestamp(observation.predictedAt);
    validateTimestamp(observation.periodStartAt);
    validateTimestamp(observation.periodEndAt);
    if (!(observation.predictedAt < observation.periodStartAt && observation.periodStartAt < observation.periodEndAt)) {
      throw new Error("EVOLVE_PAPER_CALIBRATION_LOOKAHEAD");
    }
    if (previousEndAt != null && observation.periodStartAt < previousEndAt) throw new Error("EVOLVE_PAPER_CALIBRATION_CHRONOLOGY_INVALID");
    previousEndAt = observation.periodEndAt;

    if (!boundedProbability(observation.predictedPositiveNetReturnProbability)) throw new Error("EVOLVE_PAPER_CALIBRATION_PROBABILITY_INVALID");
    if (!Number.isFinite(observation.realizedNetReturn) || observation.realizedNetReturn <= -1) throw new Error("EVOLVE_PAPER_CALIBRATION_RETURN_INVALID");
    if (observation.status !== "COMPLETED" && observation.status !== "REJECTED" && observation.status !== "HALTED") throw new Error("EVOLVE_PAPER_CALIBRATION_STATUS_INVALID");

    if (observation.status === "COMPLETED") {
      const target = observation.realizedNetReturn > 0 ? 1 : 0;
      const error = observation.predictedPositiveNetReturnProbability - target;
      predictedSum += observation.predictedPositiveNetReturnProbability;
      realizedPositive += target;
      squaredError += error * error;
      completed += 1;
    } else {
      rejectedOrHalted += 1;
    }
  }

  if (completed !== input.admission.completedPeriodCount) throw new Error("EVOLVE_PAPER_CALIBRATION_COMPLETED_COUNT_MISMATCH");

  const reasons = ["PAPER_CALIBRATION_EVIDENCE_ONLY", "NO_CONFIDENCE_PROMOTION_FROM_CALIBRATION_ALONE", "NO_EXECUTION_AUTHORITY"];
  if (rejectedOrHalted > 0) reasons.push("REJECTED_OR_HALTED_PERIODS_RETAINED");
  if (input.admission.strength !== "VERIFIED") reasons.push("PAPER_ADMISSION_INSUFFICIENT");
  if (completed === 0) reasons.push("NO_COMPLETED_CALIBRATION_OBSERVATIONS");

  return freeze({
    candidateId: admissionCandidateId,
    datasetId: admissionDatasetId,
    datasetContentSha256: input.admission.datasetContentSha256,
    regime: regime!,
    strength: input.admission.strength === "VERIFIED" && completed > 0 ? "VERIFIED" : "INSUFFICIENT",
    observationCount: ordered.length,
    completedObservationCount: completed,
    rejectedOrHaltedObservationCount: rejectedOrHalted,
    meanPredictedPositiveProbability: completed > 0 ? predictedSum / completed : null,
    realizedPositiveRate: completed > 0 ? realizedPositive / completed : null,
    brierScore: completed > 0 ? squaredError / completed : null,
    confidenceIncreaseEligible: false,
    reasons: freeze([...new Set(reasons)].sort()),
    authority: freeze({ liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
  });
}
