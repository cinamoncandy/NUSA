const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService, MOBILE_ACCESS_TTL_MS } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { MobileApprovedSession, SESSION_STORAGE_KEY } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

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
    assert.deepEqual(tables, ["mobile_access_tokens", "mobile_bootstrap_tokens", "mobile_refresh_tokens", "mobile_session_audit", "mobile_session_families"]);
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
  constructor() { this.values = new Map(); }
  async setSecret(key, value) { this.values.set(key, new Uint8Array(value)); }
  async getSecret(key) { const value = this.values.get(key); return value == null ? null : new Uint8Array(value); }
  async deleteSecret(key) { this.values.delete(key); }
}

function response(url, status, payload) {
  return { ok: status >= 200 && status < 300, status, redirected: false, url, async json() { return payload; } };
}

function tokenSet(prefix, now = Date.now()) {
  return { accessToken: `${prefix}-access-token-1234567890`, accessExpiresAt: now + 600000, refreshToken: `${prefix}-refresh-token-1234567890`, refreshExpiresAt: now + 86400000, scopes: ["dashboard:read", "paper:trade"] };
}

test("mobile runtime persists refresh only, keeps access in memory, and rotates on restore", async () => {
  const storage = new MemorySecureStorage();
  const endpoint = "https://cloud.example.com";
  const first = tokenSet("first");
  const second = tokenSet("second");
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/mobile/bootstrap")) return response(url, 200, first);
    if (url.endsWith("/v1/mobile/session/refresh")) return response(url, 200, second);
    if (url.endsWith("/v1/mobile/me")) return response(url, 200, { userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] });
    throw new Error(`unexpected url ${url}`);
  };

  const initial = new MobileApprovedSession(storage, request);
  const identity = await initial.connectBootstrap(endpoint, "bootstrap-token-1234567890");
  assert.equal(identity.userId, "mobile-user");
  assert.equal(await initial.credentialProvider(), first.accessToken);
  const storedFirst = Buffer.from(await storage.getSecret(SESSION_STORAGE_KEY)).toString("ascii");
  assert.equal(storedFirst.includes(first.refreshToken), true);
  assert.equal(storedFirst.includes(first.accessToken), false);
  initial.clearMemory();

  const restored = new MobileApprovedSession(storage, request);
  assert.equal((await restored.restore(endpoint)).userId, "mobile-user");
  assert.equal(await restored.credentialProvider(), second.accessToken);
  const storedSecond = Buffer.from(await storage.getSecret(SESSION_STORAGE_KEY)).toString("ascii");
  assert.equal(storedSecond.includes(second.refreshToken), true);
  assert.equal(storedSecond.includes(first.refreshToken), false);
  assert.equal(calls.some((call) => call.url.endsWith("/v1/mobile/session/refresh")), true);
});

test("mobile runtime fails closed without secure storage and clears endpoint-mismatched refresh state", async () => {
  const endpoint = "https://cloud.example.com";
  const noStorage = new MobileApprovedSession(null, async () => { throw new Error("network must not be reached"); });
  await assert.rejects(noStorage.connectBootstrap(endpoint, "bootstrap-token-1234567890"), /secure storage is unavailable/i);

  const storage = new MemorySecureStorage();
  await storage.setSecret(SESSION_STORAGE_KEY, Buffer.from(JSON.stringify({ endpoint, refreshToken: "refresh-token-1234567890", refreshExpiresAt: Date.now() + 600000 }), "ascii"));
  const session = new MobileApprovedSession(storage, async () => { throw new Error("network must not be reached"); });
  assert.equal(await session.restore("https://other.example.com"), null);
  assert.equal(await storage.getSecret(SESSION_STORAGE_KEY), null);
});

test("Android secure storage source uses AndroidKeyStore AES-GCM and never AsyncStorage", () => {
  const root = path.resolve(__dirname, "..");
  const native = fs.readFileSync(path.join(root, "apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaSecureStorageModule.java"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "apps/mobile/src/androidSecureStorage.ts"), "utf8");
  assert.match(native, /AndroidKeyStore/);
  assert.match(native, /AES\/GCM\/NoPadding/);
  assert.match(native, /updateAAD/);
  assert.match(native, /SharedPreferences/);
  assert.doesNotMatch(native, /AsyncStorage/);
  assert.doesNotMatch(adapter, /AsyncStorage/);
  assert.match(adapter, /bridge\.Platform\.OS !== "android"/);
  assert.doesNotMatch(adapter, /from "react-native"/);
});
