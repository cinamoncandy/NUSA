const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { DesktopSessionService, DESKTOP_ACCESS_TTL_MS } = require("../dist/apps/cloud/src/desktopSessionService.js");
const { DesktopCloudSessionStore } = require("../dist/apps/desktop/src/cloud/desktopCloudSessionStore.js");

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "user-1", email: "user@example.com", displayName: "User One" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "user-1", action: "APPROVE", now: 3 });
  const service = new DesktopSessionService(db, users);
  return { db, users, service };
}

test("owner bootstrap is single-use, hash-only, bounded, and yields exact PAPER scopes", () => {
  const { db, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 100 });
    assert.deepEqual(issued.scopes, ["dashboard:read", "paper:trade"]);
    const persisted = db.connection.prepare("SELECT token_hash, expires_at, used_at FROM desktop_bootstrap_tokens WHERE id=?").get(issued.id);
    assert.notEqual(persisted.token_hash, issued.token);
    assert.equal(persisted.token_hash.length, 64);
    assert.equal(persisted.expires_at, issued.expiresAt);
    const tokens = service.bootstrap(issued.token, 101);
    assert.ok(tokens);
    assert.equal(service.bootstrap(issued.token, 102), undefined);
    const dump = JSON.stringify(db.connection.prepare("SELECT * FROM desktop_bootstrap_tokens").all());
    assert.equal(dump.includes(issued.token), false);
    assert.equal(tokens.scopes.includes("paper:trade"), true);
    assert.equal(tokens.scopes.some((scope) => !["dashboard:read", "paper:trade"].includes(scope)), false);
  } finally { db.close(); }
});

test("bootstrap expiry and revoke-before-use fail closed", () => {
  const { db, service } = fixture();
  try {
    const expired = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 100 });
    assert.equal(service.bootstrap(expired.token, expired.expiresAt), undefined);
    const revoked = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 200 });
    assert.equal(service.revokeBootstrap({ actorUserId: "owner", bootstrapId: revoked.id, now: 201 }), true);
    assert.equal(service.bootstrap(revoked.token, 202), undefined);
  } finally { db.close(); }
});

test("access expires at ten minutes and suspended user is denied immediately", () => {
  const { db, users, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 1000 });
    const tokens = service.bootstrap(issued.token, 1001);
    assert.ok(tokens);
    assert.equal(tokens.accessExpiresAt, 1001 + DESKTOP_ACCESS_TTL_MS);
    assert.equal(service.verifyAccess(tokens.accessToken, tokens.accessExpiresAt), undefined);
    assert.equal(service.verifyAccess(tokens.accessToken, 1002).userId, "user-1");
    users.changeStatus({ actorUserId: "owner", targetUserId: "user-1", action: "SUSPEND", now: 1003 });
    assert.equal(service.verifyAccess(tokens.accessToken, 1004), undefined);
    assert.equal(service.refresh(tokens.refreshToken, 1004), undefined);
  } finally { db.close(); }
});

test("refresh rotates and reuse revokes the entire family", () => {
  const { db, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 10 });
    const first = service.bootstrap(issued.token, 11);
    const second = service.refresh(first.refreshToken, 12);
    assert.ok(second);
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.notEqual(second.accessToken, first.accessToken);
    assert.equal(service.refresh(first.refreshToken, 13), undefined);
    assert.equal(service.verifyAccess(second.accessToken, 14), undefined);
    assert.equal(service.refresh(second.refreshToken, 14), undefined);
    const family = db.connection.prepare("SELECT revoked_at, revoke_reason FROM desktop_session_families").get();
    assert.equal(family.revoked_at, 13);
    assert.equal(family.revoke_reason, "REFRESH_REUSE_DETECTED");
  } finally { db.close(); }
});

test("me exposes stable identity and no credential material", () => {
  const { db, service } = fixture();
  try {
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 20 });
    const tokens = service.bootstrap(issued.token, 21);
    const me = service.me(tokens.accessToken, 22);
    assert.deepEqual(me, { userId: "user-1", email: "user@example.com", displayName: "User One", scopes: ["dashboard:read", "paper:trade"] });
    const serialized = JSON.stringify(me);
    assert.equal(serialized.includes(tokens.accessToken), false);
    assert.equal(serialized.includes(tokens.refreshToken), false);
  } finally { db.close(); }
});

test("safeStorage store persists only ciphertext and fails closed without encryption", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-desktop-session-"));
  const filePath = path.join(directory, "session.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "dpapi",
    encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value).toString("base64")}`),
    decryptString: (value) => Buffer.from(value.toString().slice("cipher:".length), "base64").toString()
  };
  try {
    const store = new DesktopCloudSessionStore(safeStorage, filePath);
    const refreshToken = "r".repeat(48);
    store.save("https://cloud.example.com", refreshToken);
    const raw = fs.readFileSync(filePath, "utf8");
    assert.equal(raw.includes(refreshToken), false);
    assert.deepEqual(store.load(), { endpoint: "https://cloud.example.com", refreshToken });
    store.clear();
    assert.equal(fs.existsSync(filePath), false);
    const unavailable = new DesktopCloudSessionStore({ ...safeStorage, isEncryptionAvailable: () => false }, filePath);
    assert.throws(() => unavailable.save("https://cloud.example.com", refreshToken), /secure storage unavailable/);
    const weakLinux = new DesktopCloudSessionStore({ ...safeStorage, getSelectedStorageBackend: () => "basic_text" }, filePath);
    assert.throws(() => weakLinux.save("https://cloud.example.com", refreshToken), /secure storage unavailable/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
