import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateResultBundle, resolvePrimaryValue, attachSensitivityAnalysis, type EvaluationResultWithSensitivity, type SensitivityAnalysis } from "./aiEvaluationSensitivityAnalysisLabeling";

function bundle(sensitivityAnalyses: readonly SensitivityAnalysis<number>[] = []): EvaluationResultWithSensitivity<number> {
  return { primaryValue: 100, sensitivityAnalyses };
}

describe("validateResultBundle", () => {
  it("accepts no sensitivity analyses", () => assert.deepEqual(validateResultBundle(bundle()), { valid: true }));
  it("accepts well-formed distinct labels", () => assert.deepEqual(validateResultBundle(bundle([
    { label: "mnar-weighting", assumptionDescription: "MNAR censoring weight applied", value: 95 },
    { label: "plus-50pct-slippage", assumptionDescription: "Slippage assumption doubled", value: 80 },
  ])), { valid: true }));
  it("rejects missing labels", () => {
    const result = validateResultBundle(bundle([{ label: "", assumptionDescription: "x", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_SENSITIVITY_LABEL"));
  });
  it("rejects primary-label aliasing", () => {
    const result = validateResultBundle(bundle([{ label: "PRIMARY_FROZEN_RESULT", assumptionDescription: "x", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("SENSITIVITY_LABEL_ALIASES_PRIMARY"));
  });
  it("rejects duplicate labels", () => {
    const result = validateResultBundle(bundle([{ label: "mnar", assumptionDescription: "a", value: 90 }, { label: "mnar", assumptionDescription: "b", value: 85 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("DUPLICATE_SENSITIVITY_LABEL"));
  });
  it("rejects missing assumption descriptions", () => {
    const result = validateResultBundle(bundle([{ label: "mnar", assumptionDescription: "", value: 90 }]));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_ASSUMPTION_DESCRIPTION"));
  });
});

describe("resolvePrimaryValue", () => {
  it("never substitutes a sensitivity value for primary", () => assert.equal(resolvePrimaryValue(bundle([{ label: "optimistic", assumptionDescription: "best case", value: 999 }])), 100));
  it("returns primary without sensitivities", () => assert.equal(resolvePrimaryValue(bundle()), 100));
  it("fails closed for an invalid bundle", () => assert.equal(resolvePrimaryValue(bundle([{ label: "", assumptionDescription: "x", value: 90 }])), null));
});

describe("attachSensitivityAnalysis", () => {
  it("appends without mutating primary or prior analyses", () => {
    const original = bundle([{ label: "a", assumptionDescription: "x", value: 90 }]);
    const updated = attachSensitivityAnalysis(original, { label: "b", assumptionDescription: "y", value: 85 });
    assert.notEqual(updated, null);
    assert.equal(updated!.primaryValue, 100);
    assert.equal(updated!.sensitivityAnalyses.length, 2);
    assert.deepEqual(original.sensitivityAnalyses, [{ label: "a", assumptionDescription: "x", value: 90 }]);
  });
  it("rejects label collisions", () => assert.equal(attachSensitivityAnalysis(bundle([{ label: "a", assumptionDescription: "x", value: 90 }]), { label: "a", assumptionDescription: "y", value: 85 }), null));
  it("rejects primary-label aliasing", () => assert.equal(attachSensitivityAnalysis(bundle(), { label: "PRIMARY_FROZEN_RESULT", assumptionDescription: "y", value: 85 }), null));
});
