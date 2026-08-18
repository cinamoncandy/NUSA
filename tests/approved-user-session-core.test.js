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
