const test = require("node:test");
const assert = require("node:assert/strict");
const { createSecureSession, isSecureSessionUsable, touchSecureSession, revokeSecureSession } = require("../dist/apps/mobile/src/secureSession.js");

const policy = { maximumLifetimeMs: 1000, idleTimeoutMs: 100 };

test("session is usable, touchable, and expires on idle timeout", () => {
  const session = createSecureSession({ sessionId: "s1", deviceId: "d1", nowMs: 10 }, policy);
  assert.equal(isSecureSessionUsable(session, 109, policy), true);
  const touched = touchSecureSession(session, 100, policy);
  assert.equal(touched.lastActivityAtMs, 100);
  assert.equal(isSecureSessionUsable(touched, 200, policy), false);
  assert.equal(touched.expiresAtMs, 1010);
});

test("revocation is immediate and cannot be undone", () => {
  const session = createSecureSession({ sessionId: "s1", deviceId: "d1", nowMs: 10 }, policy);
  const revoked = revokeSecureSession(session, 20);
  assert.equal(isSecureSessionUsable(revoked, 20, policy), false);
  assert.equal(revokeSecureSession(revoked, 30).revokedAtMs, 20);
});

test("invalid or stale session activity fails closed", () => {
  const session = createSecureSession({ sessionId: "s1", deviceId: "d1", nowMs: 10 }, policy);
  assert.throws(() => touchSecureSession(session, 9, policy), /expired or revoked|non-monotonic/);
  assert.throws(() => createSecureSession({ sessionId: "", deviceId: "d1", nowMs: 10 }, policy), /sessionId/);
  assert.throws(() => createSecureSession({ sessionId: "s1", deviceId: "d1", nowMs: 10 }, { maximumLifetimeMs: 100, idleTimeoutMs: 101 }), /idleTimeoutMs/);
});
