import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateUxTelemetryEvent, isValidUxTelemetryEvent, type UxTelemetryEvent } from "./uxTelemetryEvent";

const base: UxTelemetryEvent = {
  schemaVersion: 1,
  eventId: "evt-1",
  kind: "SCREEN_VIEW",
  sessionId: "session-1",
  ownerPrincipalId: "owner-1",
  screenId: "HOME",
  occurredAtMs: 1_000,
};

describe("ux telemetry event contract", () => {
  it("accepts a minimal valid screen-view event", () => {
    assert.deepEqual(validateUxTelemetryEvent(base), { valid: true, errors: [] });
    assert.equal(isValidUxTelemetryEvent(base), true);
  });

  it("rejects an unrecognized event kind", () => {
    const result = validateUxTelemetryEvent({ ...base, kind: "SOMETHING_ELSE" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("KIND_INVALID"));
  });

  it("rejects free-text-shaped identifiers instead of enumerated ones", () => {
    const result = validateUxTelemetryEvent({ ...base, screenId: "the user searched for 'my account number is 1234'" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("SCREEN_ID_INVALID"));
  });

  it("requires navigationDepth on navigation events", () => {
    const result = validateUxTelemetryEvent({ ...base, kind: "NAVIGATION_PUSH" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("NAVIGATION_DEPTH_REQUIRED"));
  });

  it("accepts a navigation event with a bounded non-negative depth", () => {
    const result = validateUxTelemetryEvent({ ...base, kind: "NAVIGATION_PUSH", navigationDepth: 2 });
    assert.equal(result.valid, true);
  });

  it("rejects a negative navigation depth", () => {
    const result = validateUxTelemetryEvent({ ...base, kind: "NAVIGATION_PUSH", navigationDepth: -1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("NAVIGATION_DEPTH_INVALID"));
  });

  it("requires taskId on task lifecycle events", () => {
    for (const kind of ["TASK_STARTED", "TASK_COMPLETED", "TASK_ABANDONED"] as const) {
      const result = validateUxTelemetryEvent({ ...base, kind });
      assert.equal(result.valid, false, kind);
      assert.ok(result.errors.includes("TASK_ID_REQUIRED"), kind);
    }
  });

  it("requires actionId on a tap event", () => {
    const result = validateUxTelemetryEvent({ ...base, kind: "TAP" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("ACTION_ID_REQUIRED"));
  });

  it("accepts a fully populated task-completed event", () => {
    const result = validateUxTelemetryEvent({
      ...base,
      kind: "TASK_COMPLETED",
      taskId: "LIVE_ORDER_APPROVAL",
      reasonCode: "APPROVED",
    });
    assert.equal(result.valid, true);
  });

  it("rejects a non-object value", () => {
    assert.equal(validateUxTelemetryEvent(null).valid, false);
    assert.equal(validateUxTelemetryEvent("event").valid, false);
    assert.equal(validateUxTelemetryEvent([base]).valid, false);
  });

  it("rejects a wrong schema version", () => {
    const result = validateUxTelemetryEvent({ ...base, schemaVersion: 2 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("SCHEMA_VERSION_INVALID"));
  });

  it("rejects a negative or non-integer occurredAtMs", () => {
    assert.equal(validateUxTelemetryEvent({ ...base, occurredAtMs: -1 }).valid, false);
    assert.equal(validateUxTelemetryEvent({ ...base, occurredAtMs: 1.5 }).valid, false);
  });
});
