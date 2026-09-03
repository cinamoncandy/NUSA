import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRegimeMonitoringIdentity, isAppendOnlyLongitudinalExtension, isCurrentlyRecovered, type RegimeMonitoringIdentity, type LongitudinalEvent } from "./aiEvaluationRegimeDegradationMonitoring";
const identity = (overrides: Partial<RegimeMonitoringIdentity> = {}): RegimeMonitoringIdentity => ({ monitoringId: "m", baselineCohortId: "c", windowMs: 1000, cadenceMs: 100, permittedLooks: 4, degradationThreshold: 0.1, recoveryThreshold: 0.05, minSample: 30, dependencePolicyId: "d", missingnessPolicyId: "x", frozenAt: 1, ...overrides });
describe("regime degradation monitoring", () => {
  it("validates a complete frozen identity", () => assert.deepEqual(validateRegimeMonitoringIdentity(identity()), { valid: true }));
  it("fails closed on malformed identity", () => assert.equal(validateRegimeMonitoringIdentity(identity({ minSample: 0 })).valid, false));
  it("preserves prior degradation evidence append-only", () => {
    const d: LongitudinalEvent = { eventId: "1", monitoringId: "m", kind: "DEGRADATION", detectedAt: 10 };
    const r: LongitudinalEvent = { eventId: "2", monitoringId: "m", kind: "RECOVERY", detectedAt: 20 };
    assert.equal(isAppendOnlyLongitudinalExtension([d], [d, r]), true);
    assert.equal(isAppendOnlyLongitudinalExtension([d, r], [r]), false);
    assert.equal(isCurrentlyRecovered("m", [d, r]), true);
  });
});
