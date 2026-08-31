const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, MockSettingsRepository, SecureSettingsRepository, normalizeSettings, readEnvironmentConfiguration } = require("../dist/apps/mobile/src/settings.js");

test("settings normalize defaults and reject unsupported theme, locale, or unsafe PAPER endpoint", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.throws(() => normalizeSettings({ theme: "NEON" }), /theme/);
  assert.throws(() => normalizeSettings({ locale: "ja-JP" }), /locale/);
  assert.throws(() => normalizeSettings({ paperEndpoint: "http://192.168.1.10:41731" }), /HTTPS/);
  assert.throws(() => normalizeSettings({ paperEndpoint: "https://user:secret@paper.test" }), /credentials/);
  assert.equal(normalizeSettings({ paperEndpoint: "https://paper.test///" }).paperEndpoint, "https://paper.test");
  assert.equal(normalizeSettings({ paperEndpoint: "http://127.0.0.1:41731/" }).paperEndpoint, "http://127.0.0.1:41731");
});

test("environment configuration requires explicit endpoints and keeps only authMode default", () => {
  assert.deepEqual(readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test", EXPO_PUBLIC_NUSA_AUTH_MODE: "foundation", EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.test" }), { apiBaseUrl: "https://paper.test", authMode: "foundation", monitorUrl: "https://monitor.test" });
  assert.deepEqual(readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test", EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.test" }), { apiBaseUrl: "https://paper.test", authMode: "foundation", monitorUrl: "https://monitor.test" });
  assert.throws(() => readEnvironmentConfiguration({}), /apiBaseUrl/);
  assert.throws(() => readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test" }), /monitorUrl/);
});

test("mock settings repository persists an immutable normalized model including non-secret PAPER endpoint", async () => {
  const repository = new MockSettingsRepository();
  await repository.save({ theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true }, paperEndpoint: "https://paper.test/" });
  const loaded = await repository.load();
  assert.deepEqual(loaded, { theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true }, paperEndpoint: "https://paper.test", capitalAllocation: { investmentPercent: 100 }, usageTelemetry: { enabled: false } });
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.notifications), true);
});

test("secure settings repository persists encoded settings and endpoint but no dashboard credential", async () => {
  const values = new Map();
  const storage = { async setSecret(key, value) { values.set(key, new Uint8Array(value)); }, async getSecret(key) { return values.get(key) ?? null; }, async deleteSecret(key) { values.delete(key); } };
  const repository = new SecureSettingsRepository(storage);
  await repository.save({ theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false }, paperEndpoint: "https://paper.test" });
  const encoded = values.get("nusa:app-settings");
  assert.ok(encoded instanceof Uint8Array);
  const persistedText = new TextDecoder().decode(encoded);
  assert.match(persistedText, /"paperEndpoint":"https:\/\/paper\.test"/);
  assert.doesNotMatch(persistedText, /token|credential|authorization/i);
  assert.deepEqual(await repository.load(), { theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false }, paperEndpoint: "https://paper.test", capitalAllocation: { investmentPercent: 100 }, usageTelemetry: { enabled: false } });
});
