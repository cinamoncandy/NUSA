const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService, MOBILE_ACCESS_TTL_MS } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { LEGACY_SESSION_STORAGE_KEY, MobileApprovedSession, PAIRING_STORAGE_KEY, SESSION_STORAGE_KEY } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "mobile-user", email: "mobile@example.com", displayName: "Mobile User" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "mobile-user", action: "APPROVE", now: 3 });
  return { db, users, service: new MobileSessionService(db, users) };
}

test("mobile session uses isolated namespace and exact PAPER scopes", () => {
  const { db, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "mobile-user", now: 100 });
    assert.deepEqual(issued.scopes, ["dashboard:read", "paper:trade"]);
    const tokens = service.bootstrap(issued.token, 101);
    assert.ok(tokens);
    assert.equal(tokens.accessExpiresAt, 101 + MOBILE_ACCESS_TTL_MS);
    assert.equal(service.bootstrap(issued.token, 102), undefined);
    const tables = db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mobile_%' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, ["mobile_access_tokens", "mobile_bootstrap_tokens", "mobile_pairing_requests", "mobile_refresh_tokens", "mobile_session_audit", "mobile_session_families"]);
  } finally { db.close(); }
});

test("mobile refresh reuse revokes the session family and ACTIVE status is revalidated", () => {
  const { db, users, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "mobile-user", now: 1000 });
    const first = service.bootstrap(issued.token, 1001);
    const second = service.refresh(first.refreshToken, 1002);
    assert.ok(second);
    assert.equal(service.refresh(first.refreshToken, 1003), undefined);
    assert.equal(service.verifyAccess(second.accessToken, 1004), undefined);

    const nextIssue = service.issueBootstrap({ actorUserId: "owner", targetUserId: "mobile-user", now: 2000 });
    const next = service.bootstrap(nextIssue.token, 2001);
    users.changeStatus({ actorUserId: "owner", targetUserId: "mobile-user", action: "SUSPEND", now: 2002 });
    assert.equal(service.verifyAccess(next.accessToken, 2003), undefined);
    assert.equal(service.refresh(next.refreshToken, 2003), undefined);
  } finally { db.close(); }
});

class MemorySecureStorage {
  constructor() { this.values = new Map(); this.setCalls = 0; this.getCalls = 0; }
  async setSecret(key, value) { this.setCalls += 1; this.values.set(key, new Uint8Array(value)); }
  async getSecret(key) { this.getCalls += 1; const value = this.values.get(key); return value == null ? null : new Uint8Array(value); }
  async deleteSecret(key) { this.values.delete(key); }
}

function response(url, status, payload) {
  return { ok: status >= 200 && status < 300, status, redirected: false, url, async json() { return payload; } };
}

function tokenSet(prefix, options = {}) {
  const now = Date.now();
  return {
    accessToken: `${prefix}-access-token-1234567890`,
    accessExpiresAt: options.accessExpiresAt ?? now + 600000,
    refreshToken: `${prefix}-refresh-token-1234567890`,
    refreshExpiresAt: options.refreshExpiresAt ?? now + 86400000,
    scopes: ["dashboard:read", "paper:trade"],
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
  };
}

function identityPayload() {
  return { userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] };
}

test("Android Keystore stores only the rotating device-bound PAPER refresh capability", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const first = tokenSet("first", { accessExpiresAt: Date.now() + 1000 });
  const second = tokenSet("second");
  let refreshCalls = 0;
  const request = async (url) => {
    if (url.endsWith("/v1/mobile/bootstrap")) return response(url, 200, first);
    if (url.endsWith("/v1/mobile/session/refresh")) { refreshCalls += 1; return response(url, 200, second); }
    if (url.endsWith("/v1/mobile/me")) return response(url, 200, identityPayload());
    throw new Error(`unexpected url ${url}`);
  };

  const session = new MobileApprovedSession(storage, request);
  assert.equal((await session.connectBootstrap(endpoint, "bootstrap-token-1234567890")).userId, "mobile-user");
  assert.equal(await session.credentialProvider(), second.accessToken);
  assert.equal(refreshCalls, 1);
  assert.equal(storage.setCalls, 2);
  assert.equal(storage.getCalls, 0);
  const stored = new TextDecoder().decode(await storage.getSecret(SESSION_STORAGE_KEY));
  assert.match(stored, /second-refresh-token-1234567890/);
  assert.doesNotMatch(stored, /access-token|bootstrap-token|mobile-user|mobile@example\.com/);
  assert.equal(await storage.getSecret(PAIRING_STORAGE_KEY), null);
});

test("process restart restores only by rotating the stored PAPER refresh capability", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const request = async (url) => {
    if (url.endsWith("/v1/mobile/bootstrap")) return response(url, 200, tokenSet("initial"));
    if (url.endsWith("/v1/mobile/session/refresh")) return response(url, 200, tokenSet("restarted"));
    if (url.endsWith("/v1/mobile/me")) return response(url, 200, identityPayload());
    throw new Error(`unexpected url ${url}`);
  };
  const first = new MobileApprovedSession(storage, request);
  await first.connectBootstrap(endpoint, "bootstrap-token-1234567890");
  assert.equal(first.hasMemoryAccess(), true);
  const restarted = new MobileApprovedSession(storage, request);
  assert.equal((await restarted.restore(endpoint)).userId, "mobile-user");
  assert.equal(restarted.hasMemoryAccess(), true);
  assert.equal(storage.setCalls, 2);
  const stored = new TextDecoder().decode(await storage.getSecret(SESSION_STORAGE_KEY));
  assert.match(stored, /restarted-refresh-token-1234567890/);
  assert.doesNotMatch(stored, /restarted-access-token|mobile-user|mobile@example\.com/);
});

test("temporary refresh failure retains the Keystore capability for bounded retry", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const first = tokenSet("first", { accessExpiresAt: Date.now() + 1000 });
  const refreshed = tokenSet("refreshed");
  let attempts = 0;
  const request = async (url) => {
    if (url.endsWith("/v1/mobile/bootstrap")) return response(url, 200, first);
    if (url.endsWith("/v1/mobile/session/refresh")) {
      attempts += 1;
      return attempts === 1 ? response(url, 429, { error: "RATE_LIMITED" }) : response(url, 200, refreshed);
    }
    if (url.endsWith("/v1/mobile/me")) return response(url, 200, identityPayload());
    throw new Error(`unexpected url ${url}`);
  };
  const session = new MobileApprovedSession(storage, request);
  await session.connectBootstrap(endpoint, "bootstrap-token-1234567890");
  assert.equal(await session.credentialProvider(), null);
  assert.equal(session.shouldRetryRestore(), true);
  assert.equal(await session.credentialProvider(), refreshed.accessToken);
  assert.equal(session.shouldRetryRestore(), false);
  assert.equal(storage.setCalls, 2);
});

test("definitive refresh rejection destroys all in-memory credential authority", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const first = tokenSet("first", { accessExpiresAt: Date.now() + 1000 });
  const request = async (url) => {
    if (url.endsWith("/v1/mobile/bootstrap")) return response(url, 200, first);
    if (url.endsWith("/v1/mobile/session/refresh")) return response(url, 401, { error: "UNAUTHORIZED" });
    if (url.endsWith("/v1/mobile/me")) return response(url, 200, identityPayload());
    throw new Error(`unexpected url ${url}`);
  };
  const session = new MobileApprovedSession(storage, request);
  await session.connectBootstrap(endpoint, "bootstrap-token-1234567890");
  assert.equal(await session.credentialProvider(), null);
  assert.equal(session.hasMemoryAccess(), false);
  assert.equal(session.shouldRetryRestore(), false);
  assert.equal(await storage.getSecret(SESSION_STORAGE_KEY), null);
});

test("pairing capability is process-memory-only and restart requires a fresh pairing", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const deviceId = "nusa-install-device-0001";
  const expiresAt = Date.now() + 600000;
  const request = async (url) => {
    if (url.endsWith("/pairing/start")) return response(url, 201, { requestId: "pairing-request-id-0123456789", verificationCode: "804251", expiresAt, state: "PENDING" });
    throw new Error(`unexpected url ${url}`);
  };
  const session = new MobileApprovedSession(storage, request);
  const pairing = await session.startPairing(endpoint, deviceId);
  assert.equal(pairing.verificationCode, "804251");
  assert.deepEqual(await session.restorePendingPairing(endpoint, deviceId), pairing);
  assert.equal(storage.setCalls, 0);

  const restarted = new MobileApprovedSession(storage, request);
  assert.equal(await restarted.restorePendingPairing(endpoint, deviceId), null);
  assert.equal(storage.setCalls, 0);
});

test("pairing exchange persists only the rotating refresh capability, never pairing data", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const deviceId = "nusa-install-device-0001";
  const issued = tokenSet("paired", { deviceId });
  const request = async (url) => {
    if (url.endsWith("/pairing/start")) return response(url, 201, { requestId: "pairing-request-id-0123456789", verificationCode: "804251", expiresAt: Date.now() + 600000, state: "PENDING" });
    if (url.endsWith("/pairing/exchange")) return response(url, 200, issued);
    if (url.endsWith("/mobile/me")) return response(url, 200, identityPayload());
    throw new Error(`unexpected url ${url}`);
  };
  const session = new MobileApprovedSession(storage, request);
  const pairing = await session.startPairing(endpoint, deviceId);
  assert.equal((await session.exchangePairing(endpoint, pairing.requestId, deviceId)).userId, "mobile-user");
  assert.equal(await session.credentialProvider(), issued.accessToken);
  assert.equal(await session.restorePendingPairing(endpoint, deviceId), null);
  assert.equal(storage.setCalls, 1);
  const stored = new TextDecoder().decode(await storage.getSecret(SESSION_STORAGE_KEY));
  assert.match(stored, /paired-refresh-token-1234567890/);
  assert.doesNotMatch(stored, /paired-access-token|pairing-request-id|804251|mobile-user|mobile@example\.com/);
  assert.equal(await storage.getSecret(PAIRING_STORAGE_KEY), null);
});

test("legacy v1 and pairing material are deleted without being read or restored", async () => {
  const storage = new MemorySecureStorage();
  storage.values.set(LEGACY_SESSION_STORAGE_KEY, new Uint8Array([1, 2, 3]));
  storage.values.set(PAIRING_STORAGE_KEY, new Uint8Array([4, 5, 6]));
  const session = new MobileApprovedSession(storage, async () => { throw new Error("network must not be reached"); });
  assert.equal(await session.restore("https://cloud.example.com"), null);
  assert.equal(storage.values.has(LEGACY_SESSION_STORAGE_KEY), false);
  assert.equal(storage.values.has(PAIRING_STORAGE_KEY), false);
  assert.equal(storage.getCalls, 1);
});

test("mobile approved session persistence is limited to a rotating PAPER refresh record", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");
  assert.match(source, /PersistedRefreshSession/);
  assert.match(source, /SESSION_STORAGE_KEY = "nusa\.mobile\.approved-session\.v2"/);
  assert.match(source, /persistRefreshSession/);
  assert.match(source, /destroyLegacyPersistedCredentials/);
  assert.doesNotMatch(source, /AsyncStorage|upbitCredential|bootstrapToken:\s*this\.refreshToken|accessToken:\s*this\.accessToken/);
  assert.doesNotMatch(source, /persistPendingPairing|verificationCode.*setSecret|requestId.*setSecret/);
});
