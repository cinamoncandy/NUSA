import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAiPredictionLineage, isLineageSetConfirmatoryReady, type AiPredictionLineage } from "./aiEvaluationLineage";

function lineage(overrides: Partial<AiPredictionLineage> = {}): AiPredictionLineage {
  return {
    predictionId: "pred-1",
    evidenceId: "evidence-1",
    providerId: "provider-openai",
    modelVersionId: "model-v3",
    promptVersionId: "prompt-v7",
    schemaVersionId: "schema-v2",
    calibrationVersionId: "calibration-v4",
    outcomeId: "outcome-1",
    outcomeProvenance: "REALIZED",
    ...overrides,
  };
}

describe("validateAiPredictionLineage", () => {
  it("accepts a complete lineage with a realized outcome", () => {
    assert.deepEqual(validateAiPredictionLineage(lineage()), { valid: true });
  });

  for (const field of ["predictionId", "evidenceId", "providerId", "modelVersionId", "promptVersionId", "schemaVersionId", "calibrationVersionId", "outcomeId"] as const) {
    it(`rejects a missing ${field}`, () => {
      const result = validateAiPredictionLineage(lineage({ [field]: "" } as Partial<AiPredictionLineage>));
      assert.equal(result.valid, false);
      assert.ok((result as { errors: readonly string[] }).errors.includes(`${field.toUpperCase()}_MISSING`));
    });
  }

  it("rejects a synthetic outcome", () => {
    const result = validateAiPredictionLineage(lineage({ outcomeProvenance: "SYNTHETIC" }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("OUTCOME_NOT_REALIZED"));
  });

  it("rejects a replay outcome", () => {
    const result = validateAiPredictionLineage(lineage({ outcomeProvenance: "REPLAY" }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("OUTCOME_NOT_REALIZED"));
  });

  it("rejects a hypothetical outcome", () => {
    const result = validateAiPredictionLineage(lineage({ outcomeProvenance: "HYPOTHETICAL" }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("OUTCOME_NOT_REALIZED"));
  });

  it("reports every missing field, not just the first", () => {
    const result = validateAiPredictionLineage(lineage({ evidenceId: "", providerId: "", outcomeProvenance: "SYNTHETIC" }));
    assert.equal(result.valid, false);
    const errors = (result as { errors: readonly string[] }).errors;
    assert.ok(errors.includes("EVIDENCEID_MISSING"));
    assert.ok(errors.includes("PROVIDERID_MISSING"));
    assert.ok(errors.includes("OUTCOME_NOT_REALIZED"));
  });
});

describe("isLineageSetConfirmatoryReady", () => {
  it("is true when every lineage is valid and predictionIds are unique", () => {
    const set = [lineage({ predictionId: "p1" }), lineage({ predictionId: "p2" })];
    assert.equal(isLineageSetConfirmatoryReady(set), true);
  });

  it("is false when any lineage is invalid", () => {
    const set = [lineage({ predictionId: "p1" }), lineage({ predictionId: "p2", outcomeProvenance: "REPLAY" })];
    assert.equal(isLineageSetConfirmatoryReady(set), false);
  });

  it("is false when predictionId is duplicated (would double-count a sample)", () => {
    const set = [lineage({ predictionId: "p1" }), lineage({ predictionId: "p1" })];
    assert.equal(isLineageSetConfirmatoryReady(set), false);
  });

  it("is false for an empty set rather than vacuously true", () => {
    assert.equal(isLineageSetConfirmatoryReady([]), false);
  });
});
