/**
 * Prediction-to-outcome lineage identity for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "prediction/evidence/
 * provider/model/prompt/schema/calibration/outcome lineage" and "realized outcome separation
 * from synthetic, replay, and hypothetical results" requirements: every resolved evaluation
 * result must bind a complete, non-empty chain from the prediction through evidence, provider,
 * model, prompt, schema, and calibration versions to a realized (never synthetic/replay/
 * hypothetical) outcome. Any missing link, or an outcome that admits it is not realized, fails
 * closed rather than being silently treated as complete evidence.
 */

export type OutcomeProvenance = "REALIZED" | "SYNTHETIC" | "REPLAY" | "HYPOTHETICAL";

export interface AiPredictionLineage {
  readonly predictionId: string;
  readonly evidenceId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptVersionId: string;
  readonly schemaVersionId: string;
  readonly calibrationVersionId: string;
  readonly outcomeId: string;
  readonly outcomeProvenance: OutcomeProvenance;
}

export type LineageValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const REQUIRED_ID_FIELDS: (keyof AiPredictionLineage)[] = [
  "predictionId", "evidenceId", "providerId", "modelVersionId",
  "promptVersionId", "schemaVersionId", "calibrationVersionId", "outcomeId",
];

/**
 * Validates that a lineage record has every required link present (non-empty string) and that
 * its outcome is REALIZED. Fails closed: a missing/blank id field, or a non-REALIZED
 * outcomeProvenance, makes the lineage invalid for confirmatory evaluation -- synthetic, replay,
 * and hypothetical outcomes may exist elsewhere in the system (e.g. for scenario testing) but
 * can never satisfy this evaluation lineage's realized-outcome requirement.
 */
export function validateAiPredictionLineage(lineage: AiPredictionLineage): LineageValidation {
  const errors: string[] = [];
  for (const field of REQUIRED_ID_FIELDS) {
    const value = lineage[field];
    if (typeof value !== "string" || !value.trim()) errors.push(`${field.toUpperCase()}_MISSING`);
  }
  if (lineage.outcomeProvenance !== "REALIZED") errors.push("OUTCOME_NOT_REALIZED");
  return errors.length === 0 ? { valid: true } : { valid: false, errors: Object.freeze([...new Set(errors)]) };
}

/**
 * True only when every lineage record in the set is independently valid (see
 * validateAiPredictionLineage) and no two records share the same predictionId -- a duplicate
 * predictionId would let one prediction be counted twice in aggregate metrics, silently
 * inflating sample size.
 */
export function isLineageSetConfirmatoryReady(lineages: readonly AiPredictionLineage[]): boolean {
  if (lineages.length === 0) return false;
  const seenPredictionIds = new Set<string>();
  for (const lineage of lineages) {
    if (!validateAiPredictionLineage(lineage).valid) return false;
    if (seenPredictionIds.has(lineage.predictionId)) return false;
    seenPredictionIds.add(lineage.predictionId);
  }
  return true;
}
