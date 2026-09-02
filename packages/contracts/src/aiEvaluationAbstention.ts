/**
 * Minimum sample and observation-window abstention for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 */

export interface MinimumEvidencePolicy {
  readonly minEffectiveSampleSize: number;
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
