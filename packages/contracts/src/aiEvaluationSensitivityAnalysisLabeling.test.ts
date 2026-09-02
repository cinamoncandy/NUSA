import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateResultBundle, resolvePrimaryValue, attachSensitivityAnalysis,
  type EvaluationResultWithSensitivity, type SensitivityAnalysis,
} from "./aiEvaluationSensitivityAnalysisLabeling";

function bundle(sensitivityAnalyses: readonly SensitivityAnalysis<number>[] = []): EvaluationResultWithSensitivity<number> {
  return { primaryValue: 100, sensitivityAnalyses };
}

describe("validateResultBundle", () => {
  it("accepts a bundle with no sensitivity analyses", () => {
    assert.deepEqual(validateResultBundle(bundle()), { valid: true });
  });

  it("accepts a bundle with well-formed, distinctly labeled sensitivity analyses", () => {
    const result = validateResultBundle(bundle([
      { label: "mnar-weighting", assumptionDescription: "MNAR censoring weight applied", value: 95 },
      { label: "plus-50pct-slippage", assumptionDescription: "Slippage assumption doubled", value: 80 },
    ]));
    assert.deepEqual(result, { valid: true });
  });

  it("rejects a sensitivity analysis with a missing label", () => {
    const result = validateResultBundle(bundle([{ label: "", assumptionDescription: "x", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_SENSITIVITY_LABEL"));
  });

  it("rejects a sensitivity analysis that aliases the reserved primary label", () => {
    const result = validateResultBundle(bundle([{ label: "PRIMARY_FROZEN_RESULT", assumptionDescription: "x", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("SENSITIVITY_LABEL_ALIASES_PRIMARY"));
  });

  it("rejects duplicate sensitivity labels", () => {
    const result = validateResultBundle(bundle([
      { label: "mnar-weighting", assumptionDescription: "a", value: 90 },
      { label: "mnar-weighting", assumptionDescription: "b", value: 85 },
    ]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("DUPLICATE_SENSITIVITY_LABEL"));
  });

  it("rejects a missing assumption description", () => {
    const result = validateResultBundle(bundle([{ label: "mnar-weighting", assumptionDescription: "", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_ASSUMPTION_DESCRIPTION"));
  });
});

describe("resolvePrimaryValue", () => {
  it("returns the primary value regardless of how favorable a sensitivity analysis looks", () => {
    const b = bundle([{ label: "optimistic-scenario", assumptionDescription: "best case", value: 999 }]);
    assert.equal(resolvePrimaryValue(b), 100);
  });

  it("returns the primary value for a bundle with no sensitivity analyses", () => {
    assert.equal(resolvePrimaryValue(bundle()), 100);
  });

  it("fails closed (null) for an invalid bundle rather than returning a value from a broken bundle", () => {
    const invalid = bundle([{ label: "", assumptionDescription: "x", value: 90 }]);
    assert.equal(resolvePrimaryValue(invalid), null);
  });
});

describe("attachSensitivityAnalysis", () => {
  it("appends a new sensitivity analysis, leaving primaryValue and prior analyses untouched", () => {
    const original = bundle([{ label: "a", assumptionDescription: "x", value: 90 }]);
    const updated = attachSensitivityAnalysis(original, { label: "b", assumptionDescription: "y", value: 85 });
    assert.notEqual(updated, null);
    assert.equal(updated!.primaryValue, 100);
    assert.equal(updated!.sensitivityAnalyses.length, 2);
    assert.deepEqual(original.sensitivityAnalyses, [{ label: "a", assumptionDescription: "x", value: 90 }]); // original unmutated
  });

  it("fails closed (null) when the new analysis would collide with an existing label", () => {
    const original = bundle([{ label: "a", assumptionDescription: "x", value: 90 }]);
    const result = attachSensitivityAnalysis(original, { label: "a", assumptionDescription: "y", value: 85 });
    assert.equal(result, null);
  });

  it("fails closed (null) when the new analysis aliases the reserved primary label", () => {
    const original = bundle();
    const result = attachSensitivityAnalysis(original, { label: "PRIMARY_FROZEN_RESULT", assumptionDescription: "y", value: 85 });
    assert.equal(result, null);
  });
});
