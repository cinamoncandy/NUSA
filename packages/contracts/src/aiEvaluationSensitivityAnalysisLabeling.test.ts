import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateResultBundle, resolvePrimaryValue, attachSensitivityAnalysis, type EvaluationResultWithSensitivity, type SensitivityAnalysis } from "./aiEvaluationSensitivityAnalysisLabeling";

function bundle(sensitivityAnalyses: readonly SensitivityAnalysis<number>[] = []): EvaluationResultWithSensitivity<number> { return { primaryValue: 100, sensitivityAnalyses }; }

describe("validateResultBundle", () => {
  it("accepts distinct sensitivity labels", () => assert.deepEqual(validateResultBundle(bundle([{ label: "mnar", assumptionDescription: "MNAR weighting", value: 95 }])), { valid: true }));
  it("rejects primary aliasing", () => assert.equal(validateResultBundle(bundle([{ label: "PRIMARY_FROZEN_RESULT", assumptionDescription: "x", value: 90 }])).valid, false));
  it("rejects duplicate labels", () => assert.equal(validateResultBundle(bundle([{ label: "a", assumptionDescription: "x", value: 90 }, { label: "a", assumptionDescription: "y", value: 80 }])).valid, false));
});

describe("primary separation", () => {
  it("never substitutes sensitivity for primary", () => assert.equal(resolvePrimaryValue(bundle([{ label: "optimistic", assumptionDescription: "best", value: 999 }])), 100));
  it("rejects invalid bundles", () => assert.equal(resolvePrimaryValue(bundle([{ label: "", assumptionDescription: "x", value: 90 }])), null));
  it("appends sensitivity without mutating primary", () => assert.equal(attachSensitivityAnalysis(bundle(), { label: "a", assumptionDescription: "x", value: 90 })?.primaryValue, 100));
});
