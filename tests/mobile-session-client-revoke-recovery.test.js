const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "user-1", action: "APPROVE", now: 3 });
  return { db, users };
}

test("historical self-issued OWNER bootstrap recovers once after prompt CLIENT_REVOKED", () => {
  const { db, users } = fixture();
  try {
    const service = new MobileSessionService(db, users);
    const issuedAt = Date.parse("2026-09-07T12:00:00.000Z");
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "owner", now: issuedAt });
    const first = service.bootstrap(issued.token, issuedAt + 1_000);
    assert.ok(first);
    assert.equal(service.revokeAccess(first.accessToken, issuedAt + 50_000), true);
    const recovered = service.bootstrap(issued.token, issuedAt + 60_000);
    assert.ok(recovered);
    assert.equal(service.verifyAccess(recovered.accessToken, issuedAt + 60_001).userId, "owner");
    assert.equal(service.bootstrap(issued.token, issuedAt + 60_002), undefined, "historical secret is retired after one migration");
    const rows = db.connection.prepare("SELECT event,reason FROM mobile_session_audit WHERE event='BOOTSTRAP_RECOVERED_AFTER_CLIENT_REVOKE'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "HISTORICAL_CLIENT_BUG_MIGRATION");
  } finally { db.close(); }
});

test("migration stays closed for delegated user bootstrap and slow revocation", () => {
  const { db, users } = fixture();
  try {
    const service = new MobileSessionService(db, users);
    const issuedAt = Date.parse("2026-09-07T12:00:00.000Z");
    const delegated = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user-1", now: issuedAt });
    const delegatedTokens = service.bootstrap(delegated.token, issuedAt + 1_000);
    assert.ok(delegatedTokens); service.revokeAccess(delegatedTokens.accessToken, issuedAt + 2_000);
    assert.equal(service.bootstrap(delegated.token, issuedAt + 3_000), undefined);

    const owner = service.issueBootstrap({ actorUserId: "owner", targetUserId: "owner", now: issuedAt + 10_000 });
    const ownerTokens = service.bootstrap(owner.token, issuedAt + 11_000);
    assert.ok(ownerTokens); service.revokeAccess(ownerTokens.accessToken, issuedAt + 132_000);
    assert.equal(service.bootstrap(owner.token, issuedAt + 133_000), undefined);
  } finally { db.close(); }
});
