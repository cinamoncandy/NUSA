const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { ApprovedUserSessionService } = require("../dist/apps/cloud/src/approvedUserSessionCore.js");
const { DesktopSessionService } = require("../dist/apps/cloud/src/desktopSessionService.js");

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "user-1", email: "user@example.com", displayName: "User One" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "user-1", action: "APPROVE", now: 3 });
  return { db, users };
}

test("desktop service is a compatibility adapter over the approved-user session core", () => {
  const { db, users } = fixture();
  try {
    const service = new DesktopSessionService(db, users);
    assert.equal(service instanceof ApprovedUserSessionService, true);
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 10 });
    const tokens = service.bootstrap(issued.token, 11);
    assert.ok(tokens);
    assert.deepEqual(tokens.scopes, ["dashboard:read", "paper:trade"]);
    const desktopTables = db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'desktop_%' ORDER BY name").all();
    assert.deepEqual(desktopTables.map((row) => row.name), [
      "desktop_access_tokens",
      "desktop_bootstrap_tokens",
      "desktop_refresh_tokens",
      "desktop_session_audit",
      "desktop_session_families"
    ]);
  } finally { db.close(); }
});

test("shared core preserves ACTIVE-user authorization for an isolated client namespace", () => {
  const { db, users } = fixture();
  try {
    const service = new ApprovedUserSessionService(db, users, {
      namespace: "mobile_test",
      allowedScopes: ["dashboard:read", "paper:trade"],
      accessTtlMs: 10 * 60 * 1000,
      refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      bootstrapTtlMs: 10 * 60 * 1000
    });
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 20 });
    const tokens = service.bootstrap(issued.token, 21);
    assert.equal(service.verifyAccess(tokens.accessToken, 22).userId, "user-1");
    users.changeStatus({ actorUserId: "owner", targetUserId: "user-1", action: "SUSPEND", now: 23 });
    assert.equal(service.verifyAccess(tokens.accessToken, 24), undefined);
    assert.equal(service.refresh(tokens.refreshToken, 24), undefined);
  } finally { db.close(); }
});

test("shared core rejects unsafe SQL namespaces and unsupported scopes", () => {
  const { db, users } = fixture();
  try {
    assert.throws(() => new ApprovedUserSessionService(db, users, {
      namespace: "mobile;drop_table",
      allowedScopes: ["dashboard:read"],
      accessTtlMs: 1,
      refreshTtlMs: 1,
      bootstrapTtlMs: 1
    }), /namespace is invalid/);

    const service = new ApprovedUserSessionService(db, users, {
      namespace: "mobile_scope_test",
      allowedScopes: ["dashboard:read"],
      accessTtlMs: 100,
      refreshTtlMs: 1000,
      bootstrapTtlMs: 100
    });
    assert.throws(() => service.issueBootstrap({
      actorUserId: "owner",
      targetUserId: "user-1",
      scopes: ["paper:trade"],
      now: 30
    }), /scopes are invalid/);
  } finally { db.close(); }
});

test("rejected bootstrap attempts are durably audited without storing token material", () => {
  const { db, users } = fixture();
  try {
    const service = new ApprovedUserSessionService(db, users, {
      namespace: "bootstrap_audit_test",
      allowedScopes: ["dashboard:read"],
      accessTtlMs: 100,
      refreshTtlMs: 1000,
      bootstrapTtlMs: 10
    });
    const invalidToken = "invalid-bootstrap-secret-material";
    assert.equal(service.bootstrap(invalidToken, 40), undefined);

    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 50 });
    assert.equal(service.bootstrap(issued.token, 61), undefined);

    const rows = db.connection.prepare("SELECT event, actor_user_id, target_user_id, family_id, reason, created_at FROM bootstrap_audit_test_session_audit WHERE event='BOOTSTRAP_REJECTED' ORDER BY created_at ASC").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { event: "BOOTSTRAP_REJECTED", actor_user_id: null, target_user_id: null, family_id: null, reason: "UNKNOWN_TOKEN", created_at: 40 },
      { event: "BOOTSTRAP_REJECTED", actor_user_id: null, target_user_id: "user-1", family_id: null, reason: "EXPIRED", created_at: 61 }
    ]);
    assert.equal(JSON.stringify(rows).includes(invalidToken), false);
    assert.equal(JSON.stringify(rows).includes(issued.token), false);
  } finally { db.close(); }
});

test("rejected refresh attempts are durably audited and refresh reuse still revokes the family", () => {
  const { db, users } = fixture();
  try {
    const service = new ApprovedUserSessionService(db, users, {
      namespace: "refresh_audit_test",
      allowedScopes: ["dashboard:read"],
      accessTtlMs: 100,
      refreshTtlMs: 1000,
      bootstrapTtlMs: 100
    });
    const invalidToken = "invalid-refresh-secret-material";
    assert.equal(service.refresh(invalidToken, 70), undefined);

    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: 80 });
    const tokens = service.bootstrap(issued.token, 81);
    assert.ok(tokens);
    const refreshed = service.refresh(tokens.refreshToken, 82);
    assert.ok(refreshed);
    assert.equal(service.refresh(tokens.refreshToken, 83), undefined);

    const rejected = db.connection.prepare("SELECT event, actor_user_id, target_user_id, family_id, reason, created_at FROM refresh_audit_test_session_audit WHERE event='SESSION_REFRESH_REJECTED' ORDER BY created_at ASC").all();
    assert.equal(rejected.length, 2);
    assert.deepEqual({ ...rejected[0] }, { event: "SESSION_REFRESH_REJECTED", actor_user_id: null, target_user_id: null, family_id: null, reason: "UNKNOWN_TOKEN", created_at: 70 });
    assert.equal(rejected[1].actor_user_id, "user-1");
    assert.equal(rejected[1].target_user_id, "user-1");
    assert.equal(rejected[1].reason, "REFRESH_REUSE_DETECTED");
    assert.equal(rejected[1].created_at, 83);
    assert.equal(typeof rejected[1].family_id, "string");

    const revocation = db.connection.prepare("SELECT reason FROM refresh_audit_test_session_audit WHERE event='SESSION_REVOKED' AND created_at=83").get();
    assert.deepEqual({ ...revocation }, { reason: "REFRESH_REUSE_DETECTED" });
    assert.equal(JSON.stringify(rejected).includes(invalidToken), false);
    assert.equal(JSON.stringify(rejected).includes(tokens.refreshToken), false);
  } finally { db.close(); }
});
