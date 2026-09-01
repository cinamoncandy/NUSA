import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEvidenceSufficiency, type MinimumEvidencePolicy } from "./aiEvaluationAbstention";

const policy: MinimumEvidencePolicy = { minEffectiveSampleSize: 30, minObservationWindowMs: 604_800_000 };

describe("evaluateEvidenceSufficiency", () => {
  it("is sufficient when both effective sample size and observation window meet the policy", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 604_800_000 }, policy), { sufficient: true });
  });
  it("is sufficient when both exceed the policy minimums", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 500, observedWindowMs: 30_000_000_000 }, policy), { sufficient: true });
  });
  it("abstains when effective sample size is below the minimum, even with an ample window", () => {
    const result = evaluateEvidenceSufficiency({ effectiveSampleSize: 29, observedWindowMs: 30_000_000_000 }, policy);
    assert.equal(result.sufficient, false);
    assert.deepEqual((result as { reasons: readonly string[] }).reasons, ["INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE"]);
  });
  it("abstains when observation window is below the minimum, even with ample samples", () => {
    const result = evaluateEvidenceSufficiency({ effectiveSampleSize: 500, observedWindowMs: 1_000 }, policy);
    assert.equal(result.sufficient, false);
    assert.deepEqual((result as { reasons: readonly string[] }).reasons, ["INSUFFICIENT_OBSERVATION_WINDOW"]);
  });
  it("reports both reasons when both thresholds are missed", () => {
    const result = evaluateEvidenceSufficiency({ effectiveSampleSize: 1, observedWindowMs: 1 }, policy);
    assert.equal(result.sufficient, false);
    assert.deepEqual((result as { reasons: readonly string[] }).reasons, ["INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE", "INSUFFICIENT_OBSERVATION_WINDOW"]);
  });
  it("fails closed on invalid input and malformed policy", () => {
    for (const result of [
      evaluateEvidenceSufficiency({ effectiveSampleSize: -1, observedWindowMs: 604_800_000 }, policy),
      evaluateEvidenceSufficiency({ effectiveSampleSize: 30.1, observedWindowMs: 604_800_000 }, policy),
      evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: Number.NaN }, policy),
    ]) {
      assert.equal(result.sufficient, false);
      assert.deepEqual((result as { reasons: readonly string[] }).reasons, ["INVALID_INPUT"]);
    }
    for (const malformed of [
      { minEffectiveSampleSize: 0, minObservationWindowMs: 1_000 },
      { minEffectiveSampleSize: 30, minObservationWindowMs: 0 },
      { minEffectiveSampleSize: 30, minObservationWindowMs: -1 },
    ] satisfies MinimumEvidencePolicy[]) {
      const result = evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 604_800_000 }, malformed);
      assert.equal(result.sufficient, false);
      assert.deepEqual((result as { reasons: readonly string[] }).reasons, ["INVALID_POLICY"]);
    }
  });
  it("treats exact-threshold equality as sufficient", () => {
    assert.deepEqual(evaluateEvidenceSufficiency({ effectiveSampleSize: 30, observedWindowMs: 604_800_000 }, policy), { sufficient: true });
  });
});
