/**
 * Sensitivity-analysis / advisory-evidence separation for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 */

const PRIMARY_LABEL = "PRIMARY_FROZEN_RESULT";

export interface SensitivityAnalysis<T> {
  readonly label: string;
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

export function validateResultBundle<T>(bundle: EvaluationResultWithSensitivity<T>): ResultBundleValidation {
  const errors = new Set<string>();
  const seenLabels = new Set<string>();
  for (const analysis of bundle.sensitivityAnalyses) {
    if (typeof analysis.label !== "string" || !analysis.label.trim()) errors.add("MISSING_SENSITIVITY_LABEL");
    else if (analysis.label === PRIMARY_LABEL) errors.add("SENSITIVITY_LABEL_ALIASES_PRIMARY");
    else if (seenLabels.has(analysis.label)) errors.add("DUPLICATE_SENSITIVITY_LABEL");
    else seenLabels.add(analysis.label);
    if (typeof analysis.assumptionDescription !== "string" || !analysis.assumptionDescription.trim()) errors.add("MISSING_ASSUMPTION_DESCRIPTION");
  }
  return errors.size === 0 ? { valid: true } : { valid: false, errors: Object.freeze([...errors]) };
}

export function resolvePrimaryValue<T>(bundle: EvaluationResultWithSensitivity<T>): T | null {
  if (!validateResultBundle(bundle).valid) return null;
  return bundle.primaryValue;
}

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
