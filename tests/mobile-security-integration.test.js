const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileBiometricAuthentication } = require("../dist/apps/mobile/src/mobileSecurity.js");
const { MobileSecurityCoordinator } = require("../dist/apps/mobile/src/mobileSecurityCoordinator.js");

function setup({ trusted = true } = {}) {
  const secrets = new Map();
  const devices = new Map(trusted ? [["device-1", { deviceId: "device-1", label: "Phone", addedAtMs: 1, revokedAtMs: null }]] : []);
  const auth = new MobileBiometricAuthentication({ async isAvailable() { return true; }, async authenticate() { return true; } }, { async verify() { return true; } }, { maximumFailures: 3, lockoutMs: 100 });
  return new MobileSecurityCoordinator({ async setSecret(k, v) { secrets.set(k, new Uint8Array(v)); }, async getSecret(k) { return secrets.get(k) ?? null; }, async deleteSecret(k) { secrets.delete(k); } }, auth, { async get(k) { return devices.get(k) ?? null; }, async save(v) { devices.set(v.deviceId, v); }, async revoke(k, at) { devices.set(k, { ...devices.get(k), revokedAtMs: at }); } }, { maximumLifetimeMs: 1000, idleTimeoutMs: 100 });
}

test("security coordinator integrates trusted device, biometric session, secure data, and recovery resume", async () => {
  const coordinator = setup();
  const signedIn = await coordinator.signIn({ sessionId: "session-1", deviceId: "device-1", pin: "1234", nowMs: 10 });
  await coordinator.storeSensitive("session-secret", Uint8Array.from([1, 2]));
  assert.deepEqual([...await coordinator.readSensitive("session-secret")], [1, 2]);
  assert.equal(await coordinator.reauthenticate(signedIn.session, "1234", 20), "BIOMETRIC");
  assert.equal((await coordinator.resumeAfterRecovery(signedIn.session, 30)).sessionId, "session-1");
});

test("untrusted and revoked devices cannot sign in or resume recovery", async () => {
  const coordinator = setup({ trusted: false });
  await assert.rejects(() => coordinator.signIn({ sessionId: "s1", deviceId: "unknown", pin: "1234", nowMs: 1 }), /not trusted/);
  const trusted = setup();
  const signedIn = await trusted.signIn({ sessionId: "s1", deviceId: "device-1", pin: "1234", nowMs: 1 });
  await trusted.revokeDevice("device-1", 2);
  await assert.rejects(() => trusted.resumeAfterRecovery(signedIn.session, 3), /not trusted/);
});
