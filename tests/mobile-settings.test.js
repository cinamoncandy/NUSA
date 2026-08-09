const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, MockSettingsRepository, SecureSettingsRepository, normalizeSettings, readEnvironmentConfiguration } = require("../dist/apps/mobile/src/settings.js");

test("settings normalize defaults and reject unsupported theme or locale", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.paperEndpoint, "");
  assert.throws(() => normalizeSettings({ theme: "NEON" }), /theme/);
  assert.throws(() => normalizeSettings({ locale: "ja-JP" }), /locale/);
});

test("environment configuration requires explicit endpoints and keeps foundation auth as the safe default", () => {
  assert.deepEqual(
    readEnvironmentConfiguration({
      EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test",
      EXPO_PUBLIC_NUSA_AUTH_MODE: "foundation",
      EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.test"
    }),
    { apiBaseUrl: "https://paper.test", authMode: "foundation", monitorUrl: "https://monitor.test" }
  );
  assert.equal(
    readEnvironmentConfiguration({
      EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test",
      EXPO_PUBLIC_NUSA_MONITOR_URL: "https://monitor.test"
    }).authMode,
    "foundation"
  );
  assert.throws(() => readEnvironmentConfiguration({}), /apiBaseUrl must not be empty/);
  assert.throws(
    () => readEnvironmentConfiguration({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://paper.test" }),
    /monitorUrl must not be empty/
  );
});

test("mock settings repository persists an immutable normalized model including explicit PAPER endpoint state", async () => {
  const repository = new MockSettingsRepository();
  await repository.save({ theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true } });
  const loaded = await repository.load();
  assert.deepEqual(loaded, { theme: "DARK", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true }, paperEndpoint: "" });
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.notifications), true);
});

test("secure settings repository persists only encoded settings through secure storage", async () => {
  const values = new Map();
  const storage = { async setSecret(key, value) { values.set(key, new Uint8Array(value)); }, async getSecret(key) { return values.get(key) ?? null; }, async deleteSecret(key) { values.delete(key); } };
  const repository = new SecureSettingsRepository(storage);
  await repository.save({ theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false } });
  assert.ok(values.get("nusa:app-settings") instanceof Uint8Array);
  assert.deepEqual(await repository.load(), { theme: "LIGHT", locale: "ko-KR", notifications: { enabled: false, riskAlerts: true, orderUpdates: false }, paperEndpoint: "" });
});
