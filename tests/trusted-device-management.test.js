const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileBiometricAuthentication } = require("../dist/apps/mobile/src/mobileSecurity.js");
const { TrustedDeviceManager } = require("../dist/apps/mobile/src/trustedDeviceManagement.js");

function setup({ biometric = true, pin = true } = {}) {
  const values = new Map();
  const auth = new MobileBiometricAuthentication({ async isAvailable() { return true; }, async authenticate() { return biometric; } }, { async verify() { return pin; } }, { maximumFailures: 3, lockoutMs: 100 });
  return new TrustedDeviceManager({ async setSecret(k, v) { values.set(k, new Uint8Array(v)); }, async getSecret(k) { return values.get(k) ?? null; }, async deleteSecret(k) { values.delete(k); } }, auth);
}

test("register, rename, revoke, and list trusted devices through secure storage", async () => {
  const manager = setup();
  await manager.register("device-1", "My phone", "1234", 10);
  assert.equal((await manager.list())[0].label, "My phone");
  await manager.rename("device-1", "Owner phone", "1234", 20);
  assert.equal((await manager.requireTrusted("device-1")).label, "Owner phone");
  await manager.revoke("device-1", "1234", 30);
  assert.equal(await manager.isTrusted("device-1"), false);
});

test("unknown devices require verification and cannot be silently trusted", async () => {
  const manager = setup();
  await assert.rejects(() => manager.requireTrusted("unknown"), /requires verification/);
  await assert.rejects(() => manager.rename("unknown", "Phone", "1234", 1), /unknown or revoked/);
  await assert.rejects(() => manager.revoke("unknown", "1234", 1), /unknown or revoked/);
});

test("new-device registration and revocation require successful authentication", async () => {
  const manager = setup({ biometric: false, pin: false });
  await assert.rejects(() => manager.register("device-1", "Phone", "bad", 1), /authentication failed/);
  const trusted = setup(); await trusted.register("device-1", "Phone", "1234", 1);
  const noAuth = setup({ biometric: false, pin: false });
  await assert.rejects(() => noAuth.revoke("device-1", "bad", 2), /unknown or revoked/);
  await assert.rejects(() => trusted.register("device-1", "Phone 2", "1234", 2), /already trusted/);
});
