/**
 * Temporal identity and partition assignment for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * This is a first, narrow slice of a much larger planning-only work order (20+ requirements:
 * point-in-time data vintage, purge/embargo, multiple-testing correction, dependence-group
 * identity, economic decomposition, and more -- none of that is attempted here). It closes only
 * the first two requirements: an immutable temporal holdout/walk-forward partition identity, and
 * prediction-time causal data / future-leakage rejection via five separated clocks.
 *
 * apps/cloud/src/ai/outcomeCalibration.ts's AiCalibrationPrediction already has predictedAt and
 * anchorObservedAt, but conflates several distinct time concepts this module separates explicitly:
 *
 * - eventTime: when the real-world thing being predicted actually happened/will happen.
 * - receivedTime: when NUSA's systems first observed/ingested the anchor data.
 * - modelAvailableTime: when the model version making the prediction became available for use.
 * - predictionTime: when the prediction was actually produced.
 * - outcomeWindowStart / outcomeWindowEnd: when the outcome is/was allowed to resolve.
 *
 * A prediction is causally valid only if: modelAvailableTime <= predictionTime, receivedTime <=
 * predictionTime (the anchor data must exist before the prediction uses it), and
 * predictionTime <= outcomeWindowStart <= outcomeWindowEnd (the prediction cannot resolve against
 * an outcome window that already started or ended before the prediction was made). eventTime is
 * not required to precede predictionTime -- a forecast is explicitly a prediction about a future
 * eventTime -- but eventTime must fall within the outcome window when known.
 */

export interface AiPredictionTemporalIdentity {
  readonly eventTime: number;
  readonly receivedTime: number;
  readonly modelAvailableTime: number;
  readonly predictionTime: number;
  readonly outcomeWindowStart: number;
  readonly outcomeWindowEnd: number;
}

export interface AiTemporalIdentityValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Validates causal ordering across the five clocks. Fails closed: any missing/malformed/
 * out-of-order timestamp is rejected, never silently coerced or defaulted.
 */
export function validateAiPredictionTemporalIdentity(identity: AiPredictionTemporalIdentity): AiTemporalIdentityValidation {
  const errors: string[] = [];
  const fields: (keyof AiPredictionTemporalIdentity)[] = [
    "eventTime", "receivedTime", "modelAvailableTime", "predictionTime", "outcomeWindowStart", "outcomeWindowEnd",
  ];
  for (const field of fields) {
    if (!isTimestamp(identity[field])) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (errors.length > 0) return { valid: false, errors: Object.freeze([...new Set(errors)]) };

  if (identity.modelAvailableTime > identity.predictionTime) errors.push("MODEL_NOT_YET_AVAILABLE_AT_PREDICTION_TIME");
  if (identity.receivedTime > identity.predictionTime) errors.push("ANCHOR_DATA_RECEIVED_AFTER_PREDICTION_FUTURE_LEAKAGE");
  if (identity.predictionTime > identity.outcomeWindowStart) errors.push("PREDICTION_MADE_AFTER_OUTCOME_WINDOW_STARTED");
  if (identity.outcomeWindowStart > identity.outcomeWindowEnd) errors.push("OUTCOME_WINDOW_INVERTED");
  if (identity.eventTime < identity.outcomeWindowStart || identity.eventTime > identity.outcomeWindowEnd) {
    errors.push("EVENT_TIME_OUTSIDE_OUTCOME_WINDOW");
  }

  return { valid: errors.length === 0, errors: Object.freeze([...new Set(errors)]) };
}

export type AiEvaluationPartitionRole = "TRAIN" | "VALIDATION" | "HOLDOUT";

export interface AiEvaluationPartition {
  readonly partitionId: string;
  readonly role: AiEvaluationPartitionRole;
  /** [startTime, endTime) in predictionTime terms; half-open so adjacent partitions never overlap. */
  readonly startTime: number;
  readonly endTime: number;
}

export type AiPartitionAssignment =
  | { readonly assigned: true; readonly partitionId: string; readonly role: AiEvaluationPartitionRole }
  | { readonly assigned: false; readonly reason: "NO_MATCHING_PARTITION" | "AMBIGUOUS_OVERLAPPING_PARTITIONS" | "INVALID_PARTITION_SET" };

function partitionsAreWellFormed(partitions: readonly AiEvaluationPartition[]): boolean {
  if (partitions.length === 0) return false;
  const ids = new Set<string>();
  for (const partition of partitions) {
    if (!isTimestamp(partition.startTime) || !isTimestamp(partition.endTime) || partition.startTime >= partition.endTime) return false;
    if (!partition.partitionId.trim() || ids.has(partition.partitionId)) return false;
    ids.add(partition.partitionId);
  }
  for (let i = 0; i < partitions.length; i += 1) {
    for (let j = i + 1; j < partitions.length; j += 1) {
      const a = partitions[i];
      const b = partitions[j];
      if (a.startTime < b.endTime && b.startTime < a.endTime) return false;
    }
  }
  return true;
}

/**
 * Assigns a predictionTime to exactly one of a well-formed, non-overlapping set of partitions.
 * Fails closed (assigned: false) rather than guessing when the partition set itself is malformed,
 * overlapping, or when predictionTime falls in a gap covered by no partition -- an unassignable
 * prediction must never silently join TRAIN by default (that would let it leak into HOLDOUT
 * results downstream).
 */
export function assignAiEvaluationPartition(
  predictionTime: number,
  partitions: readonly AiEvaluationPartition[],
): AiPartitionAssignment {
  if (!partitionsAreWellFormed(partitions)) return { assigned: false, reason: "INVALID_PARTITION_SET" };
  const matches = partitions.filter((partition) => predictionTime >= partition.startTime && predictionTime < partition.endTime);
  if (matches.length === 0) return { assigned: false, reason: "NO_MATCHING_PARTITION" };
  if (matches.length > 1) return { assigned: false, reason: "AMBIGUOUS_OVERLAPPING_PARTITIONS" };
  return { assigned: true, partitionId: matches[0].partitionId, role: matches[0].role };
}

/**
 * True only when every prediction in `predictionTimes` maps to the HOLDOUT role and none of them
 * fall in a TRAIN or VALIDATION partition -- the structural check behind "finalHoldoutUntouched"
 * style guarantees elsewhere in this repo (researchHardening.ts), applied here to AI prediction
 * evaluation instead of strategy backtesting.
 */
export function isHoldoutUntouchedByTraining(
  predictionTimes: readonly number[],
  partitions: readonly AiEvaluationPartition[],
): boolean {
  if (predictionTimes.length === 0) return false;
  return predictionTimes.every((time) => {
    const assignment = assignAiEvaluationPartition(time, partitions);
    return assignment.assigned && assignment.role === "HOLDOUT";
  });
}

/**
 * Purge/embargo policy (WO-AI-011: "purge or embargo policy for overlapping realized-label
 * horizons"). A TRAIN prediction whose own outcome window overlaps a later VALIDATION/HOLDOUT
 * partition's time range has effectively seen into that partition's future and must be purged.
 * A TRAIN prediction made too close in time before a VALIDATION/HOLDOUT boundary is embargoed even
 * without a literal overlap, because serially correlated inputs (the usual case for market/event
 * data) can leak information across that boundary regardless of the declared outcome window.
 */
export interface PurgeEmbargoPolicy {
  /** Buffer immediately before a VALIDATION/HOLDOUT partition's start during which a TRAIN
   * prediction is embargoed even if its outcome window does not literally overlap that partition. */
  readonly embargoMs: number;
}

export type PurgeEmbargoDecision =
  | { readonly excluded: false }
  | { readonly excluded: true; readonly reason: "PURGED_OVERLAPPING_OUTCOME_WINDOW" | "EMBARGOED_NEAR_BOUNDARY"; readonly conflictingPartitionId: string };

export interface PurgeEmbargoCandidate {
  readonly predictionTime: number;
  readonly outcomeWindowStart: number;
  readonly outcomeWindowEnd: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Evaluates whether one TRAIN-role candidate must be purged or embargoed against the given
 * VALIDATION/HOLDOUT partitions. Only ever excludes TRAIN candidates -- a VALIDATION or HOLDOUT
 * sample is never purged/embargoed against itself or against other partitions of the same kind;
 * that is what assignAiEvaluationPartition already guarantees is disjoint. Fails closed toward
 * exclusion: on any ambiguity about overlap, the candidate is purged rather than kept.
 */
export function evaluatePurgeEmbargo(
  candidate: PurgeEmbargoCandidate,
  boundaryPartitions: readonly AiEvaluationPartition[],
  policy: PurgeEmbargoPolicy,
): PurgeEmbargoDecision {
  if (
    !isTimestamp(candidate.predictionTime) || !isTimestamp(candidate.outcomeWindowStart) || !isTimestamp(candidate.outcomeWindowEnd)
    || candidate.outcomeWindowStart > candidate.outcomeWindowEnd
    || !Number.isSafeInteger(policy.embargoMs) || policy.embargoMs < 0
  ) {
    const fallback = boundaryPartitions[0];
    return { excluded: true, reason: "PURGED_OVERLAPPING_OUTCOME_WINDOW", conflictingPartitionId: fallback?.partitionId ?? "INVALID_INPUT" };
  }

  for (const partition of boundaryPartitions) {
    if (partition.role === "TRAIN") continue;
    if (overlaps(candidate.outcomeWindowStart, candidate.outcomeWindowEnd, partition.startTime, partition.endTime)) {
      return { excluded: true, reason: "PURGED_OVERLAPPING_OUTCOME_WINDOW", conflictingPartitionId: partition.partitionId };
    }
  }
  for (const partition of boundaryPartitions) {
    if (partition.role === "TRAIN") continue;
    const embargoStart = partition.startTime - policy.embargoMs;
    if (candidate.predictionTime >= embargoStart && candidate.predictionTime < partition.startTime) {
      return { excluded: true, reason: "EMBARGOED_NEAR_BOUNDARY", conflictingPartitionId: partition.partitionId };
    }
  }
  return { excluded: false };
}
