import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateFrozenSelection, isEvaluationFamilySelectionComplete, type FrozenSelection } from "./aiEvaluationFrozenSelection";

function selection(overrides: Partial<FrozenSelection> = {}): FrozenSelection {
  return { selectionId: "sel-1", evaluationFamilyId: "family-1", kind: "BENCHMARK", frozenAt: 1_000, ...overrides };
}

describe("validateFrozenSelection", () => {
  it("accepts a selection frozen strictly before the earliest outcome observation", () => {
    assert.deepEqual(validateFrozenSelection(selection(), 2_000), { valid: true });
  });

  it("accepts a selection frozen at exactly the earliest outcome observation (boundary allowed)", () => {
    assert.deepEqual(validateFrozenSelection(selection({ frozenAt: 1_000 }), 1_000), { valid: true });
  });

  it("rejects a selection frozen after outcomes were already observed (post-hoc cherry-picking risk)", () => {
    const result = validateFrozenSelection(selection({ frozenAt: 3_000 }), 2_000);
    assert.deepEqual(result, { valid: false, reason: "SELECTION_FROZEN_AFTER_OUTCOME_OBSERVED" });
  });

  it("fails closed on a missing selectionId", () => {
    const result = validateFrozenSelection(selection({ selectionId: "" }), 2_000);
    assert.deepEqual(result, { valid: false, reason: "MISSING_SELECTION_ID_OR_FAMILY" });
  });

  it("fails closed on a missing evaluationFamilyId", () => {
    const result = validateFrozenSelection(selection({ evaluationFamilyId: "" }), 2_000);
    assert.deepEqual(result, { valid: false, reason: "MISSING_SELECTION_ID_OR_FAMILY" });
  });

  it("fails closed on an invalid frozenAt", () => {
    assert.deepEqual(validateFrozenSelection(selection({ frozenAt: Number.NaN }), 2_000), { valid: false, reason: "INVALID_FROZEN_AT" });
    assert.deepEqual(validateFrozenSelection(selection({ frozenAt: -1 }), 2_000), { valid: false, reason: "INVALID_FROZEN_AT" });
  });

  it("fails closed on an invalid earliestOutcomeObservedAt", () => {
    const result = validateFrozenSelection(selection(), Number.NaN);
    assert.deepEqual(result, { valid: false, reason: "INVALID_EARLIEST_OUTCOME_OBSERVED_AT" });
  });
});

describe("isEvaluationFamilySelectionComplete", () => {
  const requiredKinds = ["BENCHMARK", "REGIME_LABEL", "NORMALIZATION", "COST_MODEL"] as const;

  function completeSelections(): readonly FrozenSelection[] {
    return [
      selection({ selectionId: "s1", kind: "BENCHMARK", frozenAt: 500 }),
      selection({ selectionId: "s2", kind: "REGIME_LABEL", frozenAt: 500 }),
      selection({ selectionId: "s3", kind: "NORMALIZATION", frozenAt: 500 }),
      selection({ selectionId: "s4", kind: "COST_MODEL", frozenAt: 500 }),
    ];
  }

  it("is true when every required kind has exactly one valid, frozen-before-outcomes selection", () => {
    assert.equal(isEvaluationFamilySelectionComplete("family-1", requiredKinds, completeSelections(), 2_000), true);
  });

  it("is false when a required kind is missing", () => {
    const incomplete = completeSelections().filter((s) => s.kind !== "COST_MODEL");
    assert.equal(isEvaluationFamilySelectionComplete("family-1", requiredKinds, incomplete, 2_000), false);
  });

  it("is false when a required kind has a duplicate (ambiguous) selection", () => {
    const duplicated = [...completeSelections(), selection({ selectionId: "s5", kind: "BENCHMARK", frozenAt: 600 })];
    assert.equal(isEvaluationFamilySelectionComplete("family-1", requiredKinds, duplicated, 2_000), false);
  });

  it("is false when any selection was frozen after outcomes were observed", () => {
    const postHoc = [...completeSelections().filter((s) => s.kind !== "BENCHMARK"), selection({ selectionId: "s1", kind: "BENCHMARK", frozenAt: 3_000 })];
    assert.equal(isEvaluationFamilySelectionComplete("family-1", requiredKinds, postHoc, 2_000), false);
  });

  it("is false when a selection belongs to a different evaluationFamilyId", () => {
    const otherFamily = completeSelections().map((s) => ({ ...s, evaluationFamilyId: "family-2" }));
    assert.equal(isEvaluationFamilySelectionComplete("family-1", requiredKinds, otherFamily, 2_000), false);
  });

  it("is false for an empty requiredKinds list rather than vacuously true", () => {
    assert.equal(isEvaluationFamilySelectionComplete("family-1", [], completeSelections(), 2_000), false);
  });
});
