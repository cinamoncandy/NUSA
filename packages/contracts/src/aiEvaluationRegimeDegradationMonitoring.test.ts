import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateRegimeMonitoringIdentity, isAppendOnlyLongitudinalExtension, isCurrentlyRecovered,
  type RegimeMonitoringIdentity, type LongitudinalEvent,
} from "./aiEvaluationRegimeDegradationMonitoring";

function identity(overrides: Partial<RegimeMonitoringIdentity> = {}): RegimeMonitoringIdentity {
  return {
    monitoringId: "mon-1",
    baselineCohortId: "cohort-1",
    windowMs: 604_800_000,
    cadenceMs: 86_400_000,
    permittedLooks: 4,
    degradationThreshold: 0.1,
    recoveryThreshold: 0.05,
    minSample: 30,
    dependencePolicyId: "dep-1",
    missingnessPolicyId: "miss-1",
    frozenAt: 1_000,
    ...overrides,
  };
}

describe("validateRegimeMonitoringIdentity", () => {
  it("accepts a well-formed identity", () => {
    assert.deepEqual(validateRegimeMonitoringIdentity(identity()), { valid: true });
  });

  it("rejects a missing monitoringId", () => {
    const result = validateRegimeMonitoringIdentity(identity({ monitoringId: "" }));
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MISSING_MONITORING_ID"));
  });

  it("rejects a non-positive windowMs", () => {
    const result = validateRegimeMonitoringIdentity(identity({ windowMs: 0 }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_WINDOW_MS"));
  });

  it("rejects a non-positive cadenceMs", () => {
    const result = validateRegimeMonitoringIdentity(identity({ cadenceMs: -1 }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_CADENCE_MS"));
  });

  it("rejects a non-positive permittedLooks", () => {
    const result = validateRegimeMonitoringIdentity(identity({ permittedLooks: 0 }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_PERMITTED_LOOKS"));
  });

  it("rejects a non-finite degradationThreshold", () => {
    const result = validateRegimeMonitoringIdentity(identity({ degradationThreshold: Number.NaN }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_DEGRADATION_THRESHOLD"));
  });

  it("rejects a non-positive minSample", () => {
    const result = validateRegimeMonitoringIdentity(identity({ minSample: 0 }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_MIN_SAMPLE"));
  });

  it("rejects missing dependence/missingness policy ids", () => {
    const result = validateRegimeMonitoringIdentity(identity({ dependencePolicyId: "", missingnessPolicyId: "" }));
    assert.equal(result.valid, false);
    const errors = (result as { errors: readonly string[] }).errors;
    assert.ok(errors.includes("MISSING_DEPENDENCE_POLICY_ID"));
    assert.ok(errors.includes("MISSING_MISSINGNESS_POLICY_ID"));
  });

  it("rejects an invalid frozenAt", () => {
    const result = validateRegimeMonitoringIdentity(identity({ frozenAt: -1 }));
    assert.ok((result as { errors: readonly string[] }).errors.includes("INVALID_FROZEN_AT"));
  });
});

describe("isAppendOnlyLongitudinalExtension", () => {
  const degradation: LongitudinalEvent = { eventId: "e1", monitoringId: "mon-1", kind: "DEGRADATION", detectedAt: 1_000 };
  const recovery: LongitudinalEvent = { eventId: "e2", monitoringId: "mon-1", kind: "RECOVERY", detectedAt: 2_000 };

  it("is true when a new event is appended and prior events are unchanged", () => {
    assert.equal(isAppendOnlyLongitudinalExtension([degradation], [degradation, recovery]), true);
  });

  it("is true for identical histories (no-op extension)", () => {
    assert.equal(isAppendOnlyLongitudinalExtension([degradation], [degradation]), true);
  });

  it("is true for an empty previous history extended with new events", () => {
    assert.equal(isAppendOnlyLongitudinalExtension([], [degradation]), true);
  });

  it("is false when a prior event (degradation) is dropped from the candidate history", () => {
    assert.equal(isAppendOnlyLongitudinalExtension([degradation, recovery], [recovery]), false);
  });

  it("is false when a prior event's content is mutated (e.g. detectedAt changed)", () => {
    const mutated: LongitudinalEvent = { ...degradation, detectedAt: 999 };
    assert.equal(isAppendOnlyLongitudinalExtension([degradation], [mutated]), false);
  });

  it("is false when a prior event's kind is mutated (recovery pretending to overwrite degradation)", () => {
    const overwritten: LongitudinalEvent = { ...degradation, kind: "RECOVERY" };
    assert.equal(isAppendOnlyLongitudinalExtension([degradation], [overwritten]), false);
  });
});

describe("isCurrentlyRecovered", () => {
  it("is true when the most recent event for this monitoringId is RECOVERY", () => {
    const history: readonly LongitudinalEvent[] = [
      { eventId: "e1", monitoringId: "mon-1", kind: "DEGRADATION", detectedAt: 1_000 },
      { eventId: "e2", monitoringId: "mon-1", kind: "RECOVERY", detectedAt: 2_000 },
    ];
    assert.equal(isCurrentlyRecovered("mon-1", history), true);
  });

  it("is false when the most recent event is DEGRADATION", () => {
    const history: readonly LongitudinalEvent[] = [
      { eventId: "e1", monitoringId: "mon-1", kind: "RECOVERY", detectedAt: 1_000 },
      { eventId: "e2", monitoringId: "mon-1", kind: "DEGRADATION", detectedAt: 2_000 },
    ];
    assert.equal(isCurrentlyRecovered("mon-1", history), false);
  });

  it("is false for an empty history rather than assuming recovery by default", () => {
    assert.equal(isCurrentlyRecovered("mon-1", []), false);
  });

  it("is false when history has no events for this monitoringId", () => {
    const history: readonly LongitudinalEvent[] = [{ eventId: "e1", monitoringId: "mon-2", kind: "RECOVERY", detectedAt: 1_000 }];
    assert.equal(isCurrentlyRecovered("mon-1", history), false);
  });
});
