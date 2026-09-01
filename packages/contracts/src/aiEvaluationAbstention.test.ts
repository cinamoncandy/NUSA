import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEvidenceSufficiency, type MinimumEvidencePolicy } from "./aiEvaluationAbstention";

const policy: MinimumEvidencePolicy = { minEffectiveSampleSize: 30, minObservationWindowMs: 604_800_000 };

describe("evaluateEvidenceSufficiency", () => {
  it("passes exact thresholds", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 604_800_000 }, policy), { sufficient: true });
  });
  it("abstains on insufficient samples", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 29, observedWindowMs: 604_800_000 }, policy), { sufficient: false, reasons: ["INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE"] });
  });
  it("abstains on insufficient window", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 1_000 }, policy), { sufficient: false, reasons: ["INSUFFICIENT_OBSERVATION_WINDOW"] });
  });
  it("reports both insufficiency reasons", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 1, observedWindowMs: 1 }, policy), { sufficient: false, reasons: ["INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE", "INSUFFICIENT_OBSERVATION_WINDOW"] });
  });
  it("fails closed on invalid input", () => {
    for (const input of [
      { effectiveSampleSize: -1, observedWindowMs: 604_800_000 },
      { effectiveSampleSize: 30.1, observedWindowMs: 604_800_000 },
      { effectiveSampleSize: 30, observedWindowMs: Number.NaN },
    ]) assert.deepEqual(evaluateEvidenceSufficiency(input, policy), { sufficient: false, reasons: ["INVALID_INPUT"] });
  });
  it("fails closed on malformed policy", () => {
    for (const malformed of [
      { minEffectiveSampleSize: 0, minObservationWindowMs: 1_000 },
      { minEffectiveSampleSize: 30, minObservationWindowMs: 0 },
      { minEffectiveSampleSize: 30, minObservationWindowMs: -1 },
    ] satisfies MinimumEvidencePolicy[]) {
      assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 604_800_000 }, malformed), { sufficient: false, reasons: ["INVALID_POLICY"] });
    }
  });
});
