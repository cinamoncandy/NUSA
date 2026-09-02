/**
 * Sensitivity-analysis / advisory-evidence separation for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes the "economic sensitivity
 * analysis remains separately labeled advisory evidence and cannot overwrite the primary
 * frozen-cost result" requirement, and the structurally identical MNAR/censoring-aware
 * sensitivity-analysis requirement from the eligible-cohort section -- both are the same shape:
 * a robustness check run under an alternative assumption must never silently replace, or be
 * confused with, the evaluation's one frozen primary result. This module makes that structural:
 * `primaryValue` is a distinct field a sensitivity analysis can never occupy, and every
 * sensitivity entry must carry a non-empty assumption description and a label that cannot alias
 * the reserved primary label.
 */

const PRIMARY_LABEL = "PRIMARY_FROZEN_RESULT";

export interface SensitivityAnalysis<T> {
  readonly label: string;
  /** What alternative assumption this analysis explores, e.g. "MNAR weighting" or "+50% slippage". */
  readonly assumptionDescription: string;
  readonly value: T;
}

export interface EvaluationResultWithSensitivity<T> {
  readonly primaryValue: T;
  readonly sensitivityAnalyses: readonly SensitivityAnalysis<T>[];
}

export type ResultBundleValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

/**
 * Validates that every sensitivity analysis in the bundle has a non-empty label distinct from the
 * reserved primary label, a non-empty assumption description, and that no two sensitivity
 * analyses share a label. Fails closed on any violation -- an unlabeled or ambiguously-labeled
 * sensitivity result could otherwise be mistaken for (or silently substituted as) the primary
 * frozen result downstream.
 */
export function validateResultBundle<T>(bundle: EvaluationResultWithSensitivity<T>): ResultBundleValidation {
  const errors = new Set<string>();
  const seenLabels = new Set<string>();
  for (const analysis of bundle.sensitivityAnalyses) {
    if (typeof analysis.label !== "string" || !analysis.label.trim()) errors.add("MISSING_SENSITIVITY_LABEL");
    else if (analysis.label === PRIMARY_LABEL) errors.add("SENSITIVITY_LABEL_ALIASES_PRIMARY");
    else if (seenLabels.has(analysis.label)) errors.add("DUPLICATE_SENSITIVITY_LABEL");
    else seenLabels.add(analysis.label);

    if (typeof analysis.assumptionDescription !== "string" || !analysis.assumptionDescription.trim()) {
      errors.add("MISSING_ASSUMPTION_DESCRIPTION");
    }
  }
  return errors.size === 0 ? { valid: true } : { valid: false, errors: Object.freeze([...errors]) };
}

/**
 * Returns the bundle's primary value. This function exists (rather than callers reaching into
 * `bundle.primaryValue` directly) to make the structural guarantee explicit and enforce
 * validation first: it never reads from `sensitivityAnalyses`, so there is no code path by which
 * a sensitivity result -- however favorable -- can be returned as if it were the primary result.
 * Fails closed (returns null) if the bundle itself is invalid.
 */
export function resolvePrimaryValue<T>(bundle: EvaluationResultWithSensitivity<T>): T | null {
  if (!validateResultBundle(bundle).valid) return null;
  return bundle.primaryValue;
}

/**
 * Returns a new bundle with one additional sensitivity analysis appended, leaving `primaryValue`
 * and all existing sensitivity analyses untouched -- a pure, additive operation. Fails closed
 * (returns null) if appending would make the bundle invalid (label collision, missing fields).
 */
export function attachSensitivityAnalysis<T>(
  bundle: EvaluationResultWithSensitivity<T>,
  analysis: SensitivityAnalysis<T>,
): EvaluationResultWithSensitivity<T> | null {
  const candidate: EvaluationResultWithSensitivity<T> = {
    primaryValue: bundle.primaryValue,
    sensitivityAnalyses: [...bundle.sensitivityAnalyses, analysis],
  };
  return validateResultBundle(candidate).valid ? candidate : null;
}
