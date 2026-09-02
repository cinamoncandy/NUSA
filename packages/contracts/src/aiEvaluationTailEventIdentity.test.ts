import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTailEventFamilyDefinition, isTailEventFamilyConfirmatory, type TailEventFamilyDefinition } from "./aiEvaluationTailEventIdentity";

function family(overrides: Partial<TailEventFamilyDefinition> = {}): TailEventFamilyDefinition {
  return {
    familyId: "tail-1",
    eventClass: "VOLATILITY_SPIKE",
    thresholdValue: 3.0,
    lookbackWindowMs: 86_400_000,
    severityBands: [{ name: "MODERATE", minSeverity: 3 }, { name: "SEVERE", minSeverity: 5 }, { name: "EXTREME", minSeverity: 8 }],
    minEffectiveEventCount: 10,
    frozenAt: 1_000,
    ...overrides,
  };
}

describe("validateTailEventFamilyDefinition", () => {
  it("accepts a well-formed family", () => {
    assert.deepEqual(validateTailEventFamilyDefinition(family()), { valid: true });
  });

  it("rejects a missing familyId", () => {
    const result = validateTailEventFamilyDefinition(family({ familyId: "" }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_FAMILY_ID"));
  });

  it("rejects a non-positive threshold", () => {
    const result = validateTailEventFamilyDefinition(family({ thresholdValue: 0 }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_THRESHOLD"));
  });

  it("rejects a non-positive lookback window", () => {
    const result = validateTailEventFamilyDefinition(family({ lookbackWindowMs: -1 }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_LOOKBACK_WINDOW"));
  });

  it("rejects a non-positive minEffectiveEventCount", () => {
    const result = validateTailEventFamilyDefinition(family({ minEffectiveEventCount: 0 }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_MIN_EFFECTIVE_EVENT_COUNT"));
  });

  it("rejects an empty severity-bands list", () => {
    const result = validateTailEventFamilyDefinition(family({ severityBands: [] }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("EMPTY_SEVERITY_BANDS"));
  });

  it("rejects severity bands that are not strictly increasing by minSeverity", () => {
    const result = validateTailEventFamilyDefinition(family({
      severityBands: [{ name: "MODERATE", minSeverity: 5 }, { name: "SEVERE", minSeverity: 3 }],
    }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("SEVERITY_BANDS_NOT_STRICTLY_INCREASING"));
  });

  it("rejects duplicate severity-band names", () => {
    const result = validateTailEventFamilyDefinition(family({
      severityBands: [{ name: "SEVERE", minSeverity: 3 }, { name: "SEVERE", minSeverity: 5 }],
    }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("DUPLICATE_SEVERITY_BAND_NAME"));
  });

  it("rejects an invalid frozenAt", () => {
    const result = validateTailEventFamilyDefinition(family({ frozenAt: Number.NaN }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_FROZEN_AT"));
  });
});

describe("isTailEventFamilyConfirmatory", () => {
  it("is true for a well-formed family frozen strictly before the earliest outcome observation", () => {
    assert.equal(isTailEventFamilyConfirmatory(family({ frozenAt: 1_000 }), 2_000), true);
  });

  it("is false when the family was frozen at exactly the earliest outcome observation (post-hoc tuning risk)", () => {
    assert.equal(isTailEventFamilyConfirmatory(family({ frozenAt: 2_000 }), 2_000), false);
  });

  it("is false when the family was frozen after outcomes were observed", () => {
    assert.equal(isTailEventFamilyConfirmatory(family({ frozenAt: 3_000 }), 2_000), false);
  });

  it("is false for an internally malformed family regardless of freeze timing", () => {
    assert.equal(isTailEventFamilyConfirmatory(family({ thresholdValue: -1, frozenAt: 100 }), 2_000), false);
  });

  it("is false for an invalid earliestOutcomeObservedAt", () => {
    assert.equal(isTailEventFamilyConfirmatory(family(), Number.NaN), false);
  });
});
