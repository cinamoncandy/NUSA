const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileBiometricAuthentication } = require("../dist/apps/mobile/src/mobileSecurity.js");

function auth({ available = true, biometric = true, pin = true } = {}) {
  const calls = [];
  return { calls, service: new MobileBiometricAuthentication({ async isAvailable() { return available; }, async authenticate(reason) { calls.push(`biometric:${reason}`); return biometric; } }, { async verify() { calls.push("pin"); return typeof pin === "function" ? pin() : pin; } }, { maximumFailures: 2, lockoutMs: 100 }) };
}

test("successful biometric authentication resets failures and records re-authentication", async () => {
  const h = auth();
  assert.equal(await h.service.authenticate("unlock", "1234", 10), "BIOMETRIC");
  assert.equal(await h.service.reauthenticateSession("1234", 20), "BIOMETRIC");
  assert.equal(h.service.snapshot().lastAuthenticatedAtMs, 20);
  assert.deepEqual(h.calls, ["biometric:unlock", "biometric:Session re-authentication"]);
});

test("PIN is used only as fallback when biometric is unavailable or fails", async () => {
  const unavailable = auth({ available: false });
  assert.equal(await unavailable.service.authenticate("unlock", "1234", 1), "PIN");
  assert.deepEqual(unavailable.calls, ["pin"]);
  const failed = auth({ biometric: false });
  assert.equal(await failed.service.requireCriticalAction("reset Paper account", "1234", 1), "PIN");
  assert.deepEqual(failed.calls, ["biometric:Critical action: reset Paper account", "pin"]);
});

test("repeated failures lock authentication and cannot bypass critical actions", async () => {
  let pinAttempts = 0;
  const h = auth({ biometric: false, pin: () => ++pinAttempts >= 3 });
  await assert.rejects(() => h.service.authenticate("unlock", "bad", 10), /authentication failed/);
  await assert.rejects(() => h.service.requireCriticalAction("order", "bad", 20), /authentication failed/);
  assert.equal(h.service.snapshot().lockedUntilMs, 120);
  await assert.rejects(() => h.service.requireCriticalAction("order", "1234", 50), /locked/);
  assert.equal(await h.service.reauthenticateSession("1234", 120), "PIN");
});

test("invalid policies and critical action labels fail closed", async () => {
  assert.throws(() => new MobileBiometricAuthentication({ async isAvailable() { return true; }, async authenticate() { return true; } }, { async verify() { return true; } }, { maximumFailures: 0, lockoutMs: 100 }), /invalid biometric policy/);
  const h = auth();
  await assert.rejects(() => h.service.requireCriticalAction("  ", "1234", 1), /action/);
});
