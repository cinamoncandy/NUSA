const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, MockSettingsRepository, SecureSettingsRepository, normalizeSettings, readEnvironmentConfiguration } = require("../dist/apps/mobile/src/settings.js");

test("settings normalize a product model without endpoint or bearer state", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.throws(() => normalizeSettings({ theme: "NEON" }), /theme/);
  assert.throws(() => normalizeSettings({ locale: "ja-JP" }), /locale/);
  const legacy = normalizeSettings({ paperEndpoint: "https://old-quick-tunnel.invalid", dashboardBearer: "legacy" });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, "paperEndpoint"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, "dashboardBearer"), false);
});

test("environment configuration requires explicit endpoint and remains HTTPS-only", () => {
  assert.deepEqual(readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://nusa.example", EXPO_PUBLIC_NUSA_AUTH_MODE: "foundation", EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.example" }), { apiBaseUrl: "https://nusa.example", authMode: "foundation", monitorUrl: "https://monitor.example" });
  assert.throws(() => readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "http://nusa.example", EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.example" }), /HTTPS/);
  assert.throws(() => readEnvironmentConfiguration({}), /required/);
});

test("settings repositories migrate legacy endpoint and bearer fields out of persistence", async () => {
  const repository = new MockSettingsRepository();
  await repository.save({ theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true }, paperEndpoint: "https://old.example", dashboardBearer: "legacy" });
  assert.deepEqual(await repository.load(), { theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true }, capitalAllocation: { investmentPercent: 100 } });
  const values = new Map();
  const storage = { async setSecret(key, value) { values.set(key, new Uint8Array(value)); }, async getSecret(key) { return values.get(key) ?? null; }, async deleteSecret(key) { values.delete(key); } };
  const secure = new SecureSettingsRepository(storage);
  await secure.save({ theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false }, paperEndpoint: "https://old.example", dashboardBearer: "legacy" });
  const persistedText = new TextDecoder().decode(values.get("nusa:app-settings"));
  assert.doesNotMatch(persistedText, /paperEndpoint|dashboardBearer|token|credential|authorization/i);
  assert.deepEqual(await secure.load(), { theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false }, capitalAllocation: { investmentPercent: 100 } });
});
