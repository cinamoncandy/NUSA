/**
 * Frozen benchmark/regime-label/normalization/cost-model selection identity for AI prediction
 * evaluation (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "frozen benchmark,
 * regime-label, normalization, and cost-model identities without future leakage" and "benchmark
 * and opportunity-cost baselines are frozen before outcome observation; post-hoc benchmark
 * selection is prohibited" requirements: a benchmark/regime-label/normalization/cost-model
 * choice bound to an evaluation family must have been frozen (selected and locked) strictly
 * before any outcome in that family was observed. A selection frozen at or after the first
 * observed outcome could have been cherry-picked to flatter the result -- that is exactly the
 * leakage this module rejects, regardless of how plausible the selection looks in isolation.
 */

export type FrozenSelectionKind = "BENCHMARK" | "REGIME_LABEL" | "NORMALIZATION" | "COST_MODEL";

export interface FrozenSelection {
  readonly selectionId: string;
  readonly evaluationFamilyId: string;
  readonly kind: FrozenSelectionKind;
  /** When this selection was frozen (locked in), independent of when outcomes resolve. */
  readonly frozenAt: number;
}

export type FrozenSelectionValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason: "SELECTION_FROZEN_AFTER_OUTCOME_OBSERVED" | "INVALID_FROZEN_AT" | "INVALID_EARLIEST_OUTCOME_OBSERVED_AT" | "MISSING_SELECTION_ID_OR_FAMILY";
    };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Validates that `selection` was frozen strictly before `earliestOutcomeObservedAt` -- the earliest
 * moment any outcome in its evaluationFamilyId became known. Fails closed: a selection frozen at
 * or after that moment is rejected as post-hoc (potential cherry-picking), and malformed input
 * (missing ids, invalid timestamps) is rejected rather than assumed valid.
 */
export function validateFrozenSelection(selection: FrozenSelection, earliestOutcomeObservedAt: number): FrozenSelectionValidation {
  if (typeof selection.selectionId !== "string" || !selection.selectionId.trim()
    || typeof selection.evaluationFamilyId !== "string" || !selection.evaluationFamilyId.trim()) {
    return { valid: false, reason: "MISSING_SELECTION_ID_OR_FAMILY" };
  }
  if (!isTimestamp(selection.frozenAt)) return { valid: false, reason: "INVALID_FROZEN_AT" };
  if (!isTimestamp(earliestOutcomeObservedAt)) return { valid: false, reason: "INVALID_EARLIEST_OUTCOME_OBSERVED_AT" };
  if (selection.frozenAt >= earliestOutcomeObservedAt) return { valid: false, reason: "SELECTION_FROZEN_AFTER_OUTCOME_OBSERVED" };
  return { valid: true };
}

/**
 * True only when every kind required by `requiredKinds` has exactly one valid (see
 * validateFrozenSelection), frozen-before-outcomes selection bound to `evaluationFamilyId` --
 * the structural check that a confirmatory evaluation did not proceed with a missing, duplicate,
 * or post-hoc benchmark/regime-label/normalization/cost-model choice.
 */
export function isEvaluationFamilySelectionComplete(
  evaluationFamilyId: string,
  requiredKinds: readonly FrozenSelectionKind[],
  selections: readonly FrozenSelection[],
  earliestOutcomeObservedAt: number,
): boolean {
  if (requiredKinds.length === 0) return false;
  const familySelections = selections.filter((selection) => selection.evaluationFamilyId === evaluationFamilyId);

  return requiredKinds.every((kind) => {
    const matches = familySelections.filter((selection) => selection.kind === kind);
    if (matches.length !== 1) return false;
    return validateFrozenSelection(matches[0], earliestOutcomeObservedAt).valid;
  });
}
