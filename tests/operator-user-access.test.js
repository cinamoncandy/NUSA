const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryNusaUserAccessRepository, SqliteNusaUserAccessRepository, isUserAllowed } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { handleOperatorUserAccessHttp } = require("../dist/apps/cloud/src/operatorUserAccessHttp.js");

const verifier = {
  verify(token) {
    if (token === "operator-token") return { userId: "operator", scopes: ["dashboard:read", "users:manage"] };
    if (token === "reader-token") return { userId: "reader", scopes: ["dashboard:read"] };
    return undefined;
  }
};

function request(method, token, body) {
  return { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

test("new users are pending until the owner explicitly approves them", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  const user = repository.registerUser({ id: "u1", email: "User@Example.com", displayName: " User One " }, 2);
  assert.equal(user.status, "PENDING");
  assert.equal(user.email, "user@example.com");
  assert.equal(isUserAllowed(user), false);
  const active = repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "APPROVE", now: 3 });
  assert.equal(active.status, "ACTIVE");
  assert.equal(isUserAllowed(active), true);
  assert.equal(repository.listAudit().length, 1);
});

test("owner bootstrap fails closed instead of promoting a colliding user identity", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.registerUser({ id: "operator", email: "attacker@example.com" }, 1);
  assert.throws(() => repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 2), /owner bootstrap identity collision/);
  assert.equal(repository.get("operator").role, "USER");
  assert.equal(repository.get("operator").status, "PENDING");
});

test("SQLite owner bootstrap fails closed instead of promoting a colliding persisted user", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqliteNusaUserAccessRepository(db);
    repository.registerUser({ id: "operator", email: "attacker@example.com" }, 1);
    assert.throws(() => repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 2), /owner bootstrap identity collision/);
    assert.equal(repository.get("operator").role, "USER");
    assert.equal(repository.get("operator").status, "PENDING");
  } finally {
    db.close();
  }
});

test("owner can reject, suspend, and restore while every change is audited", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "u1", email: "user@example.com" }, 2);
  repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "REJECT", reason: "invite revoked", now: 3 });
  repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "RESTORE", now: 4 });
  repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "SUSPEND", now: 5 });
  assert.equal(repository.get("u1").status, "SUSPENDED");
  assert.deepEqual(repository.listAudit().map((entry) => entry.action), ["SUSPEND", "RESTORE", "REJECT"]);
});

test("invalid approval state transitions fail closed for both repository implementations", () => {
  for (const create of [
    () => ({ repository: new InMemoryNusaUserAccessRepository(), close() {} }),
    () => {
      const db = new SqliteDatabase(":memory:");
      return { repository: new SqliteNusaUserAccessRepository(db), close() { db.close(); } };
    }
  ]) {
    const { repository, close } = create();
    repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
    repository.registerUser({ id: "u1", email: "user@example.com" }, 2);
    assert.throws(() => repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "SUSPEND" }), /invalid user status transition/);
    assert.equal(repository.get("u1").status, "PENDING");
    repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "APPROVE", now: 3 });
    assert.throws(() => repository.changeStatus({ actorUserId: "operator", targetUserId: "u1", action: "REJECT" }), /invalid user status transition/);
    close();
  }
});

test("duplicate user identity emails fail closed instead of binding two accounts", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.registerUser({ id: "u1", email: "User@Example.com" }, 1);
  assert.throws(() => repository.registerUser({ id: "u2", email: "user@example.com" }, 2), /user identity collision/);
  assert.throws(() => repository.registerUser({ id: "u1", email: "other@example.com" }, 2), /user identity collision/);
  assert.throws(() => repository.ensureOwner({ id: "owner", email: "user@example.com" }, 2), /user identity collision/);
});

test("non-owner and owner-self mutations fail closed", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "u1", email: "user1@example.com" }, 2);
  repository.registerUser({ id: "u2", email: "user2@example.com" }, 2);
  assert.throws(() => repository.changeStatus({ actorUserId: "u1", targetUserId: "u2", action: "APPROVE" }), /operator authority/);
  assert.throws(() => repository.changeStatus({ actorUserId: "operator", targetUserId: "operator", action: "SUSPEND" }), /owner access/);
});

test("operator HTTP list and approval require operator write scope", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "u1", email: "user@example.com" }, 2);

  const denied = handleOperatorUserAccessHttp(request("GET", "reader-token"), { verifier, tokenVerifier: verifier, repository });
  assert.equal(denied.status, 403);

  const list = handleOperatorUserAccessHttp(request("GET", "operator-token"), { tokenVerifier: verifier, repository });
  assert.equal(list.status, 200);
  assert.equal(JSON.parse(list.body).users.length, 2);

  const approved = handleOperatorUserAccessHttp(request("POST", "operator-token", { targetUserId: "u1", action: "APPROVE" }), { tokenVerifier: verifier, repository });
  assert.equal(approved.status, 200);
  assert.equal(JSON.parse(approved.body).user.status, "ACTIVE");
});

test("operator HTTP boundary rejects malformed actions and unauthenticated calls", () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  assert.equal(handleOperatorUserAccessHttp({ method: "GET", headers: {} }, { tokenVerifier: verifier, repository }).status, 401);
  assert.equal(handleOperatorUserAccessHttp(request("POST", "operator-token", { targetUserId: "u1", action: "DELETE" }), { tokenVerifier: verifier, repository }).status, 400);
});
