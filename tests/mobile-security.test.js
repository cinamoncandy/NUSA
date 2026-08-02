const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileSecurityService } = require("../dist/apps/mobile/src/mobileSecurity.js");

function harness({ biometricAvailable = true, biometricResult = true, pinResult = true } = {}) {
  const secrets = new Map();
  const devices = new Map();
  const calls = [];
  return {
    calls,
    service: new MobileSecurityService(
      { async setSecret(key, value) { calls.push(`set:${key}`); secrets.set(key, new Uint8Array(value)); }, async getSecret(key) { return secrets.get(key) ?? null; }, async deleteSecret(key) { secrets.delete(key); } },
      { async isAvailable() { return biometricAvailable; }, async authenticate() { calls.push("biometric"); return biometricResult; } },
      { async verify() { calls.push("pin"); return pinResult; } },
      { async get(id) { return devices.get(id) ?? null; }, async save(device) { devices.set(device.deviceId, device); }, async revoke(id, at) { devices.set(id, { ...devices.get(id), revokedAtMs: at }); } }
    )
  };
}

test("secrets only cross the secure-storage platform boundary", async () => {
  const h = harness();
  await h.service.storeSecret("session", new Uint8Array([1, 2, 3]));
  assert.deepEqual([...await h.service.readSecret("session")], [1, 2, 3]);
  assert.deepEqual(h.calls, ["set:session"]);
});

test("biometric succeeds first and PIN is the explicit fallback", async () => {
  const biometric = harness();
  assert.equal(await biometric.service.authenticate("unlock NUSA", "1234"), "BIOMETRIC");
  assert.deepEqual(biometric.calls, ["biometric"]);
  const fallback = harness({ biometricResult: false });
  assert.equal(await fallback.service.authenticate("unlock NUSA", "1234"), "PIN");
  assert.deepEqual(fallback.calls, ["biometric", "pin"]);
});

test("trusted devices can be added and revoked, and revoked devices stay untrusted", async () => {
  const h = harness();
  await h.service.registerDevice("device-1", "Owner phone", 100);
  assert.equal(await h.service.isTrusted("device-1"), true);
  await h.service.revokeDevice("device-1", 200);
  assert.equal(await h.service.isTrusted("device-1"), false);
  await assert.rejects(() => h.service.revokeDevice("device-1", 300), /not trusted/);
});

test("invalid security inputs fail closed", async () => {
  const h = harness({ biometricAvailable: false, pinResult: false });
  await assert.rejects(() => h.service.authenticate("unlock NUSA", "1234"), /authentication failed/);
  await assert.rejects(() => h.service.storeSecret("", new Uint8Array([1])), /key/);
  await assert.rejects(() => h.service.registerDevice("device-1", "Phone", -1), /addedAtMs/);
});
