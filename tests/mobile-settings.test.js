const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, MockSettingsRepository, SecureSettingsRepository, normalizeSettings, readEnvironmentConfiguration } = require("../dist/apps/mobile/src/settings.js");

test("settings normalize defaults and reject unsupported theme or locale", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.throws(() => normalizeSettings({ theme: "NEON" }), /theme/);
  assert.throws(() => normalizeSettings({ locale: "ja-JP" }), /locale/);
});

test("environment configuration uses explicit environment values and safe defaults", () => {
  assert.deepEqual(readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test", EXPO_PUBLIC_NUSA_AUTH_MODE: "foundation", EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.test" }), { apiBaseUrl: "https://paper.test", authMode: "foundation", monitorUrl: "https://monitor.test" });
  assert.equal(readEnvironmentConfiguration({}).authMode, "foundation");
});

test("mock settings repository persists an immutable normalized model", async () => {
  const repository = new MockSettingsRepository();
  await repository.save({ theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true } });
  assert.deepEqual(await repository.load(), { theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true } });
});

test("secure settings repository persists only encoded settings through secure storage", async () => {
  const values = new Map();
  const storage = { async setSecret(key, value) { values.set(key, new Uint8Array(value)); }, async getSecret(key) { return values.get(key) ?? null; }, async deleteSecret(key) { values.delete(key); } };
  const repository = new SecureSettingsRepository(storage);
  await repository.save({ theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false } });
  assert.ok(values.get("nusa:app-settings") instanceof Uint8Array);
  assert.deepEqual(await repository.load(), { theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false } });
});
