import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { screenIdForNavigationState, createUxTelemetrySessionId } from "./uxTelemetryScreenTracking";

describe("screenIdForNavigationState", () => {
  it("uses the utility view when one is open", () => {
    assert.equal(screenIdForNavigationState("Home", "SETTINGS"), "SETTINGS");
    assert.equal(screenIdForNavigationState("Portfolio", "NOTIFICATIONS"), "NOTIFICATIONS");
  });

  it("falls back to the active tab when no utility view is open", () => {
    assert.equal(screenIdForNavigationState("Home", null), "Home");
    assert.equal(screenIdForNavigationState("AiSignal", null), "AiSignal");
  });
});

describe("createUxTelemetrySessionId", () => {
  it("embeds the given timestamp", () => {
    const id = createUxTelemetrySessionId(1_700_000_000_000, () => 0.123456789);
    assert.ok(id.startsWith("mobile-1700000000000-"));
  });

  it("produces different ids for different random draws", () => {
    const first = createUxTelemetrySessionId(1_000, () => 0.1);
    const second = createUxTelemetrySessionId(1_000, () => 0.9);
    assert.notEqual(first, second);
  });

  it("matches the safe-identifier shape the telemetry event contract requires", () => {
    const id = createUxTelemetrySessionId(1_700_000_000_000, () => 0.55555);
    assert.match(id, /^[A-Za-z0-9_.:-]{1,128}$/);
  });
});
