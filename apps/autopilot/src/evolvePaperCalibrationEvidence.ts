import { createHash } from "node:crypto";
import {
  guardEvolutionConfidence,
  type EvolutionConfidenceDecision,
  type EvolutionConfidenceEvidence,
} from "./evolveConfidenceGuard";

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

export type PaperCalibrationComparisonStatus = "VERIFIED_IMPROVEMENT" | "REGRESSION" | "INSUFFICIENT";

export interface PaperCalibrationComparison {
  readonly status: PaperCalibrationComparisonStatus;
  readonly baseline: PaperCalibrationEvidenceSummary;
  readonly candidate: PaperCalibrationEvidenceSummary;
  readonly baselineWindow: { readonly startAt: number; readonly endAt: number };
  readonly candidateWindow: { readonly startAt: number; readonly endAt: number };
  /** Candidate minus baseline; lower Brier score is the only improvement direction. */
  readonly brierScoreDelta: number | null;
  readonly confidenceIncreaseEligible: boolean;
  readonly confidenceEvidence?: EvolutionConfidenceEvidence;
  readonly decision: EvolutionConfidenceDecision;
  readonly reasons: readonly string[];
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id)/i;
/** The existing PAPER admission contract uses thirty completed periods as the minimum breadth. */
export const MIN_CALIBRATION_COMPARISON_PERIODS = 30;
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

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("EVOLVE_PAPER_CALIBRATION_FORBIDDEN_CYCLE");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error("EVOLVE_PAPER_CALIBRATION_FORBIDDEN_FIELD");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("EVOLVE_PAPER_CALIBRATION_CANONICAL_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("EVOLVE_PAPER_CALIBRATION_CANONICAL_CYCLE");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`)
      .join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new Error("EVOLVE_PAPER_CALIBRATION_CANONICAL_VALUE_INVALID");
}

function observationWindow(observations: readonly PaperCalibrationObservation[], field: string): { readonly startAt: number; readonly endAt: number } {
  if (observations.length === 0) throw new Error(`EVOLVE_PAPER_CALIBRATION_${field}_EMPTY`);
  const ordered = [...observations].sort((left, right) => left.periodStartAt - right.periodStartAt || left.observationId.localeCompare(right.observationId));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  return freeze({ startAt: first.periodStartAt, endAt: last.periodEndAt });
}

function comparisonEvidenceId(
  baseline: PaperCalibrationEvidenceSummary,
  candidate: PaperCalibrationEvidenceSummary,
  baselineObservations: readonly PaperCalibrationObservation[],
  candidateObservations: readonly PaperCalibrationObservation[],
): string {
  const normalize = (observations: readonly PaperCalibrationObservation[]) => [...observations]
    .sort((left, right) => left.periodStartAt - right.periodStartAt || left.observationId.localeCompare(right.observationId))
    .map((observation) => ({
      observationId: normalizedIdentifier(observation.observationId, "OBSERVATION_ID"),
      candidateId: normalizedIdentifier(observation.candidateId, "CANDIDATE_ID"),
      datasetId: normalizedIdentifier(observation.datasetId, "DATASET_ID"),
      datasetContentSha256: observation.datasetContentSha256,
      regime: normalizedIdentifier(observation.regime, "REGIME"),
      predictedAt: observation.predictedAt,
      periodStartAt: observation.periodStartAt,
      periodEndAt: observation.periodEndAt,
      predictedPositiveNetReturnProbability: observation.predictedPositiveNetReturnProbability,
      realizedNetReturn: observation.realizedNetReturn,
      status: observation.status,
    }));
  const payload = {
    baseline,
    baselineObservations: normalize(baselineObservations),
    candidate,
    candidateObservations: normalize(candidateObservations),
  };
  return `paper-calibration-comparison:${createHash("sha256").update(canonical(payload), "utf8").digest("hex")}`;
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
  rejectForbidden(input.admission);
  rejectForbidden(input.observations);
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

/**
 * Compares two already-admitted, provenance-identical PAPER calibration windows and projects
 * the result through the existing confidence guard. The windows must be disjoint and ordered;
 * calibration is never treated as independent merely because a caller labels it that way.
 * This is a read-only projection: it does not mutate confidence, promote a candidate, or grant
 * execution/LIVE authority.
 */
export function comparePaperCalibrationEvidence(input: {
  readonly baseline: { readonly admission: PaperCalibrationAdmissionBinding; readonly observations: readonly PaperCalibrationObservation[] };
  readonly candidate: { readonly admission: PaperCalibrationAdmissionBinding; readonly observations: readonly PaperCalibrationObservation[] };
  readonly currentConfidence: number;
  readonly requestedConfidence: number;
}): PaperCalibrationComparison {
  const baseline = buildPaperCalibrationEvidence(input.baseline);
  const candidate = buildPaperCalibrationEvidence(input.candidate);
  const baselineWindow = observationWindow(input.baseline.observations, "BASELINE");
  const candidateWindow = observationWindow(input.candidate.observations, "CANDIDATE");

  if (baseline.candidateId !== candidate.candidateId || baseline.datasetId !== candidate.datasetId || baseline.datasetContentSha256 !== candidate.datasetContentSha256 || baseline.regime !== candidate.regime) {
    throw new Error("EVOLVE_PAPER_CALIBRATION_COMPARISON_PROVENANCE_MISMATCH");
  }
  if (baselineWindow.endAt > candidateWindow.startAt) throw new Error("EVOLVE_PAPER_CALIBRATION_COMPARISON_WINDOWS_OVERLAP");
  const baselineObservationIds = new Set(input.baseline.observations.map((observation) => normalizedIdentifier(observation.observationId, "OBSERVATION_ID")));
  if (input.candidate.observations.some((observation) => baselineObservationIds.has(normalizedIdentifier(observation.observationId, "OBSERVATION_ID")))) {
    throw new Error("EVOLVE_PAPER_CALIBRATION_COMPARISON_DUPLICATE_OBSERVATION");
  }

  const evidenceReady = baseline.strength === "VERIFIED" && candidate.strength === "VERIFIED" &&
    baseline.completedObservationCount >= MIN_CALIBRATION_COMPARISON_PERIODS &&
    candidate.completedObservationCount >= MIN_CALIBRATION_COMPARISON_PERIODS;
  const brierScoreDelta = baseline.brierScore == null || candidate.brierScore == null ? null : candidate.brierScore - baseline.brierScore;
  const evidenceId = evidenceReady ? comparisonEvidenceId(baseline, candidate, input.baseline.observations, input.candidate.observations) : undefined;
  const confidenceEvidence = evidenceId == null ? undefined : Object.freeze({
    id: evidenceId,
    source: "paper.calibration.comparison",
    quality: 1,
    independent: true,
  });
  const status: PaperCalibrationComparisonStatus = !evidenceReady || brierScoreDelta == null || brierScoreDelta === 0
    ? "INSUFFICIENT"
    : brierScoreDelta < 0 ? "VERIFIED_IMPROVEMENT" : "REGRESSION";
  const decision = guardEvolutionConfidence({
    currentConfidence: input.currentConfidence,
    requestedConfidence: input.requestedConfidence,
    outcome: status,
    evidence: confidenceEvidence == null ? [] : [confidenceEvidence],
  });
  const reasons = [
    "PAPER_CALIBRATION_COMPARISON",
    "TEMPORALLY_DISJOINT_WINDOWS",
    "EXISTING_CONFIDENCE_GUARD",
    "NO_EXECUTION_AUTHORITY",
    status === "VERIFIED_IMPROVEMENT" ? "Brier score improved against independent baseline" : `CALIBRATION_${status}`,
  ];
  if (!evidenceReady) reasons.push("CALIBRATION_COMPARISON_INSUFFICIENT");

  return freeze({
    status,
    baseline,
    candidate,
    baselineWindow,
    candidateWindow,
    brierScoreDelta,
    confidenceIncreaseEligible: status === "VERIFIED_IMPROVEMENT" && decision.increased,
    ...(confidenceEvidence == null ? {} : { confidenceEvidence }),
    decision,
    reasons: freeze([...new Set(reasons)].sort()),
    authority: freeze({ liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
  });
}
