const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileBiometricAuthentication } = require("../dist/apps/mobile/src/mobileSecurity.js");
const { TrustedDeviceManager } = require("../dist/apps/mobile/src/trustedDeviceManagement.js");
const { MobileSessionManager } = require("../dist/apps/mobile/src/sessionSecurity.js");

function setup() {
  const values = new Map();
  const storage = { async setSecret(k, v) { values.set(k, new Uint8Array(v)); }, async getSecret(k) { return values.get(k) ?? null; }, async deleteSecret(k) { values.delete(k); } };
  const auth = new MobileBiometricAuthentication({ async isAvailable() { return false; }, async authenticate() { return false; } }, { async verify(pin) { return pin === "1234"; } }, { maximumFailures: 3, lockoutMs: 100 });
  const devices = new TrustedDeviceManager(storage, auth);
  return { storage, devices, manager: new MobileSessionManager(storage, devices, auth, { maximumLifetimeMs: 1000, idleTimeoutMs: 100 }) };
}

test("session is securely persisted, refreshed, and revoked", async () => {
  const { devices, manager } = setup();
  await devices.register("phone", "Owner phone", "1234", 10);
  const created = await manager.create("session-1", "phone", "1234", 20);
  assert.equal((await manager.load("session-1")).deviceId, "phone");
  assert.equal((await manager.refresh("session-1", "1234", 30)).lastActivityAtMs, 30);
  await manager.revoke("session-1", 40);
  await assert.rejects(() => manager.requireUsable("session-1", 41), /expired, revoked, or untrusted/);
  assert.equal(created.expiresAtMs, 1020);
});

test("unknown or revoked devices cannot create or continue sessions", async () => {
  const { devices, manager } = setup();
  await assert.rejects(() => manager.create("session-1", "unknown", "1234", 1), /unknown or revoked/);
  await devices.register("phone", "Owner phone", "1234", 10);
  await manager.create("session-1", "phone", "1234", 20);
  await devices.revoke("phone", "1234", 30);
  await assert.rejects(() => manager.requireUsable("session-1", 31), /expired, revoked, or untrusted/);
});

test("idle timeout and authentication failures fail closed", async () => {
  const { devices, manager } = setup();
  await devices.register("phone", "Owner phone", "1234", 10);
  await manager.create("session-1", "phone", "1234", 20);
  await assert.rejects(() => manager.refresh("session-1", "bad", 30), /authentication failed/);
  await assert.rejects(() => manager.requireUsable("session-1", 121), /expired, revoked, or untrusted/);
});


test("session refresh rejects clock rollback instead of moving activity backwards", async () => {
  const { devices, manager } = setup();
  await devices.register("phone", "Owner phone", "1234", 10);
  await manager.create("session-1", "phone", "1234", 20);
  await assert.rejects(() => manager.refresh("session-1", "1234", 19), /non-monotonic/);
  assert.equal((await manager.load("session-1")).lastActivityAtMs, 20);
});
