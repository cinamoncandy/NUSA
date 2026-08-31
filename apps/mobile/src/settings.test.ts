import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, normalizeSettings, MockSettingsRepository } from "./settings";

describe("usageTelemetry setting", () => {
  it("defaults to disabled", () => {
    assert.equal(DEFAULT_SETTINGS.usageTelemetry.enabled, false);
  });

  it("stays disabled when normalizing an input with no usageTelemetry field at all (backward compatibility with settings saved before this field existed)", () => {
    const normalized = normalizeSettings({});
    assert.equal(normalized.usageTelemetry.enabled, false);
  });

  it("respects an explicit true value", () => {
    const normalized = normalizeSettings({ usageTelemetry: { enabled: true } });
    assert.equal(normalized.usageTelemetry.enabled, true);
  });

  it("respects an explicit false value even when other fields are customized", () => {
    const normalized = normalizeSettings({ theme: "DARK", usageTelemetry: { enabled: false } });
    assert.equal(normalized.usageTelemetry.enabled, false);
    assert.equal(normalized.theme, "DARK");
  });

  it("rejects a non-boolean usageTelemetry.enabled", () => {
    assert.throws(() => normalizeSettings({ usageTelemetry: { enabled: "yes" as unknown as boolean } }));
  });

  it("round-trips through MockSettingsRepository", async () => {
    const repository = new MockSettingsRepository();
    await repository.save({ ...DEFAULT_SETTINGS, usageTelemetry: { enabled: true } });
    const loaded = await repository.load();
    assert.equal(loaded?.usageTelemetry.enabled, true);
  });
});
