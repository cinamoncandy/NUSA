/**
 * Minimum sample and observation-window abstention for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "minimum sample and
 * observation-window abstention as INSUFFICIENT_EVIDENCE" requirement: a metric computed from
 * too few independent samples, or over too short an observation window, must abstain rather than
 * report a number that looks precise but rests on too little evidence. Composes with
 * aiEvaluationDependenceGroups.ts's effectiveSampleSize -- the count that matters here is the
 * dependence-adjusted effective sample size, not the raw candidate count, since correlated
 * observations must not be counted as independent evidence.
 */

export interface MinimumEvidencePolicy {
  /** Minimum dependence-adjusted effective sample size required before a metric may report a value. */
  readonly minEffectiveSampleSize: number;
  /** Minimum observation window (in the same time units as observedWindowMs) the evaluated
   * predictions must actually span before a metric may report a value. */
  readonly minObservationWindowMs: number;
}

export interface EvidenceSufficiencyInput {
  readonly effectiveSampleSize: number;
  readonly observedWindowMs: number;
}

export type EvidenceSufficiencyResult =
  | { readonly sufficient: true }
  | { readonly sufficient: false; readonly reasons: readonly ("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE" | "INSUFFICIENT_OBSERVATION_WINDOW" | "INVALID_POLICY" | "INVALID_INPUT")[] };

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function policyIsWellFormed(policy: MinimumEvidencePolicy): boolean {
  return Number.isSafeInteger(policy.minEffectiveSampleSize) && policy.minEffectiveSampleSize > 0
    && Number.isSafeInteger(policy.minObservationWindowMs) && policy.minObservationWindowMs > 0;
}

/**
 * Decides whether a metric computed from `input` has enough evidence to report a value under a
 * frozen `policy`, or must abstain as INSUFFICIENT_EVIDENCE. Fails closed: a malformed policy or
 * malformed input (fractional/negative/non-finite sample size or negative/non-finite window) is
 * treated as insufficient, never as passing by default. Both conditions are checked and every
 * failing reason is reported, so a caller does not have to guess which threshold was missed.
 */
export function evaluateEvidenceSufficiency(input: EvidenceSufficiencyInput, policy: MinimumEvidencePolicy): EvidenceSufficiencyResult {
  if (!policyIsWellFormed(policy)) return { sufficient: false, reasons: ["INVALID_POLICY"] };
  if (!isNonNegativeSafeInteger(input.effectiveSampleSize) || !isNonNegativeFiniteNumber(input.observedWindowMs)) {
    return { sufficient: false, reasons: ["INVALID_INPUT"] };
  }

  const reasons: ("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE" | "INSUFFICIENT_OBSERVATION_WINDOW")[] = [];
  if (input.effectiveSampleSize < policy.minEffectiveSampleSize) reasons.push("INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE");
  if (input.observedWindowMs < policy.minObservationWindowMs) reasons.push("INSUFFICIENT_OBSERVATION_WINDOW");

  return reasons.length === 0 ? { sufficient: true } : { sufficient: false, reasons: Object.freeze(reasons) };
}
