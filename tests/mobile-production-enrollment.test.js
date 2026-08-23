const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { handleMobileEnrollmentHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");
const { resolveCanonicalCloudOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");
const { MobileApprovedSession, SESSION_STORAGE_KEY } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

function setup() {
  const db = new SqliteDatabase(":memory:");
  const users = new InMemoryNusaUserAccessRepository();
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "user", email: "user@nusa.local" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "user", action: "APPROVE", now: 3 });
  const service = new MobileSessionService(db, users);
  const legacyTokenVerifier = {
    verify(token) {
      return token === "approved-user-token-1234567890"
        ? { userId: "user", email: "user@nusa.local", scopes: ["dashboard:read", "paper:trade"] }
        : undefined;
    }
  };
  return { db, users, service, legacyTokenVerifier };
}

test("canonical origin is HTTPS-only and never invents a production host", () => {
  assert.equal(resolveCanonicalCloudOrigin({}, false).status, "DEPLOYMENT_CONFIG_PENDING");
  assert.equal(resolveCanonicalCloudOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "http://localhost:3000" }, false).status, "DEPLOYMENT_CONFIG_PENDING");
  assert.deepEqual(resolveCanonicalCloudOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "http://localhost:3000", NODE_ENV: "development" }, true), { status: "READY", origin: "http://localhost:3000" });
  assert.deepEqual(resolveCanonicalCloudOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://cloud.example.test/" }, false), { status: "READY", origin: "https://cloud.example.test" });
  assert.equal(resolveCanonicalCloudOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://user:pass@cloud.example.test" }, false).status, "DEPLOYMENT_CONFIG_PENDING");
});

test("self enrollment issues a one-time token without users:manage or LIVE capability", () => {
  const { db, users, service, legacyTokenVerifier } = setup();
  try {
    const response = handleMobileEnrollmentHttp({
      method: "POST",
      headers: { authorization: "Bearer approved-user-token-1234567890" },
      body: JSON.stringify({ deviceId: "nusa-install-test-device-1234" })
    }, { sessionService: service, legacyTokenVerifier, userAccessRepository: users });
    assert.equal(response.status, 201);
    const payload = JSON.parse(response.body);
    assert.equal(typeof payload.token, "string");
    assert.deepEqual(payload.scopes, ["dashboard:read", "paper:trade"]);
    assert.equal(payload.scopes.includes("users:manage"), false);
    assert.equal(service.bootstrap(payload.token, 4, "nusa-install-other-device-9999"), undefined);
    const issuedAgain = service.issueSelfBootstrap({ actorUserId: "user", deviceId: "nusa-install-test-device-1234", now: 5 });
    assert.equal(service.bootstrap(issuedAgain.token, 6, "nusa-install-test-device-1234") !== undefined, true);
  } finally { db.close(); }
});

test("enrollment rejects unauthenticated, inactive, malformed, and non-POST requests", () => {
  const { db, users, service, legacyTokenVerifier } = setup();
  try {
    const dependencies = { sessionService: service, legacyTokenVerifier, userAccessRepository: users };
    assert.equal(handleMobileEnrollmentHttp({ method: "GET", headers: {} }, dependencies).status, 405);
    assert.equal(handleMobileEnrollmentHttp({ method: "POST", headers: {} , body: "{}" }, dependencies).status, 403);
    assert.equal(handleMobileEnrollmentHttp({ method: "POST", headers: { authorization: "Bearer approved-user-token-1234567890" }, body: JSON.stringify({ deviceId: "bad" }) }, dependencies).status, 400);
    users.changeStatus({ actorUserId: "owner", targetUserId: "user", action: "SUSPEND" });
    assert.equal(handleMobileEnrollmentHttp({ method: "POST", headers: { authorization: "Bearer approved-user-token-1234567890" }, body: JSON.stringify({ deviceId: "nusa-install-test-device-1234" }) }, dependencies).status, 403);
  } finally { db.close(); }
});

test("mobile enrollment sends the first credential once and persists only the rotated refresh material", async () => {
  const values = new Map();
  const storage = { async setSecret(key, value) { values.set(key, new Uint8Array(value)); }, async getSecret(key) { return values.get(key) ?? null; }, async deleteSecret(key) { values.delete(key); } };
  const calls = [];
  const tokens = { accessToken: "access-token-enrollment-123456", accessExpiresAt: Date.now() + 600000, refreshToken: "refresh-token-enrollment-123456", refreshExpiresAt: Date.now() + 86400000, scopes: ["dashboard:read", "paper:trade"] };
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/mobile/enroll")) return { ok: true, status: 201, redirected: false, url, async json() { return { token: ["bootstrap", "token", "enrollment", "123456"].join("-") }; } };
    if (url.endsWith("/v1/mobile/bootstrap")) return { ok: true, status: 200, redirected: false, url, async json() { return tokens; } };
    if (url.endsWith("/v1/mobile/me")) return { ok: true, status: 200, redirected: false, url, async json() { return { userId: "user", email: "user@nusa.local", scopes: tokens.scopes }; } };
    throw new Error(`unexpected url ${url}`);
  };
  const session = new MobileApprovedSession(storage, request);
  await session.enroll("https://cloud.example.test", "first-user-credential-123456", "nusa-install-device-1234");
  assert.match(calls[0].init.headers.authorization, /^Bearer first-user-credential/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { deviceId: "nusa-install-device-1234" });
  assert.deepEqual(JSON.parse(calls[1].init.body), { bootstrapToken: "bootstrap-token-enrollment-123456", deviceId: "nusa-install-device-1234" });
  const persisted = Buffer.from(values.get(SESSION_STORAGE_KEY)).toString("ascii");
  assert.equal(persisted.includes("first-user-credential"), false);
  assert.equal(persisted.includes(tokens.accessToken), false);
  assert.equal(persisted.includes(tokens.refreshToken), true);
});
