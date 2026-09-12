"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { handleOwnerPasswordSignInHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");
const { FREE_ATTEMPTS } = require("../dist/apps/cloud/src/ownerCredential/ownerPasswordThrottle.js");

/**
 * The whole point of this route is that the owner can get back in with something they remember,
 * from a phone, with no file to read. These check that it does that and nothing more.
 */

const OWNER = Object.freeze({ userId: "owner", email: "owner@nusa.local", scopes: ["users:manage"] });
const TEST_PHRASE = ["correct", "horse", "battery", "staple"].join(" ");
const DEVICE = "nusa-install-owners-phone";

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: OWNER.userId, email: OWNER.email }, 1);
  users.registerUser({ id: "member", email: "member@example.com" }, 2);
  users.changeStatus({ actorUserId: OWNER.userId, targetUserId: "member", action: "APPROVE", now: 3 });
  const service = new MobileSessionService(db, users);
  const deps = Object.freeze({
    sessionService: service,
    legacyTokenVerifier: Object.freeze({ ownerPrincipal: OWNER, verify: () => undefined }),
    userAccessRepository: users
  });
  return { db, users, service, deps };
}

const post = (body) => Object.freeze({ method: "POST", headers: Object.freeze({}), body: JSON.stringify(body) });

test("the owner's password issues a device-bound session, with no token anywhere in the flow", () => {
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    const outcome = service.signInWithOwnerPassword({ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE, now: 101 });
    assert.equal(outcome.status, "ISSUED");
    assert.ok(outcome.tokens.accessToken);
    assert.ok(outcome.tokens.refreshToken);
    assert.equal(outcome.tokens.accessToken.includes(TEST_PHRASE), false);
  } finally { db.close(); }
});

test("the password is never stored, echoed, or recoverable from the database", () => {
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    const rows = db.connection.prepare("SELECT * FROM nusa_owner_password").all();
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows).includes(TEST_PHRASE), false);
    assert.equal(JSON.stringify(rows).includes("horse"), false);
  } finally { db.close(); }
});

test("a wrong password is refused, and an unconfigured server refuses identically", () => {
  const { db, service } = fixture();
  try {
    // Nothing set up yet.
    assert.equal(service.signInWithOwnerPassword({ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE, now: 100 }).status, "REJECTED");
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 101);
    assert.equal(service.signInWithOwnerPassword({ userId: OWNER.userId, password: ["wrong", "password", "entirely"].join("-"), deviceId: DEVICE, now: 102 }).status, "REJECTED");
    assert.equal(service.signInWithOwnerPassword({ userId: "member", password: TEST_PHRASE, deviceId: DEVICE, now: 103 }).status, "REJECTED");
  } finally { db.close(); }
});

test("a password row that outlived its account grants nothing", () => {
  // The owner cannot be suspended through user approval -- the repository forbids it deliberately
  // -- so the reachable version of "correct password, account may not sign in" is a stale
  // credential row: the account is gone and the hash is still there.
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    db.connection.prepare("UPDATE nusa_owner_password SET user_id=? WHERE user_id=?").run("deleted-owner", OWNER.userId);
    assert.equal(service.signInWithOwnerPassword({ userId: "deleted-owner", password: TEST_PHRASE, deviceId: DEVICE, now: 101 }).status, "REJECTED");
  } finally { db.close(); }
});

test("a non-owner account cannot sign in even holding a valid hash", () => {
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    const hash = db.connection.prepare("SELECT password_hash FROM nusa_owner_password WHERE user_id=?").get(OWNER.userId).password_hash;
    db.connection.prepare("INSERT INTO nusa_owner_password(user_id,password_hash,updated_at,failures,locked_until,last_failure_at) VALUES(?,?,?,0,NULL,NULL)")
      .run("member", hash, 100);
    assert.equal(service.signInWithOwnerPassword({ userId: "member", password: TEST_PHRASE, deviceId: DEVICE, now: 101 }).status, "REJECTED");
  } finally { db.close(); }
});

test("guessing locks out, and the lock answers 429 with Retry-After rather than a silent 401", () => {
  const { db, service, deps } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    for (let attempt = 0; attempt <= FREE_ATTEMPTS; attempt += 1) {
      handleOwnerPasswordSignInHttp(post({ userId: OWNER.userId, password: "guess", deviceId: DEVICE }), deps);
    }
    const locked = handleOwnerPasswordSignInHttp(post({ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE }), deps);
    assert.equal(locked.status, 429);
    assert.equal(JSON.parse(locked.body).error, "PASSWORD_ATTEMPTS_THROTTLED");
    assert.ok(Number(locked.headers["retry-after"]) > 0, "an honest owner who mistyped needs to be told how long");
  } finally { db.close(); }
});

test("a successful sign-in clears the penalty", () => {
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    for (let attempt = 0; attempt < FREE_ATTEMPTS; attempt += 1) {
      service.signInWithOwnerPassword({ userId: OWNER.userId, password: "guess", deviceId: DEVICE, now: 101 });
    }
    assert.equal(service.signInWithOwnerPassword({ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE, now: 102 }).status, "ISSUED");
    const row = db.connection.prepare("SELECT failures,locked_until FROM nusa_owner_password WHERE user_id=?").get(OWNER.userId);
    assert.equal(Number(row.failures), 0);
    assert.equal(row.locked_until, null);
  } finally { db.close(); }
});

test("the route refuses a malformed request before touching the password", () => {
  const { db, service, deps } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    for (const body of [{ password: TEST_PHRASE, deviceId: DEVICE }, { userId: OWNER.userId, password: TEST_PHRASE }, { userId: OWNER.userId, password: TEST_PHRASE, deviceId: "short" }, { userId: OWNER.userId, password: TEST_PHRASE, deviceId: "bad\nid-with-newline" }]) {
      assert.equal(handleOwnerPasswordSignInHttp(post(body), deps).status, 400, `${JSON.stringify(body)} was not refused`);
    }
    // A refused request must not have cost the owner an attempt.
    assert.equal(Number(db.connection.prepare("SELECT failures FROM nusa_owner_password WHERE user_id=?").get(OWNER.userId).failures), 0);
  } finally { db.close(); }
});

test("no response body ever contains the password", () => {
  const { db, service, deps } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    for (const body of [{ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE }, { userId: OWNER.userId, password: "wrong", deviceId: DEVICE }, { userId: "", password: TEST_PHRASE, deviceId: DEVICE }]) {
      const response = handleOwnerPasswordSignInHttp(post(body), deps);
      assert.equal(response.body.includes(TEST_PHRASE), false, "a response echoed the password");
      assert.equal(response.body.includes("wrong"), false);
    }
  } finally { db.close(); }
});

test("only an owner account can have a password set", () => {
  const { db, service } = fixture();
  try {
    assert.throws(() => service.setOwnerPassword("member", TEST_PHRASE, 100), /owner account required/);
    assert.throws(() => service.setOwnerPassword("nobody", TEST_PHRASE, 100), /owner account required/);
    assert.throws(() => service.setOwnerPassword(OWNER.userId, "short", 100), /PASSWORD_TOO_SHORT/);
  } finally { db.close(); }
});

test("health can tell an owner whether setup has happened yet", () => {
  const { db, service } = fixture();
  try {
    assert.equal(service.ownerPasswordConfigured(), false);
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    assert.equal(service.ownerPasswordConfigured(), true);
  } finally { db.close(); }
});

test("replacing the password invalidates the old one and clears any lock", () => {
  const { db, service } = fixture();
  try {
    service.setOwnerPassword(OWNER.userId, TEST_PHRASE, 100);
    for (let attempt = 0; attempt <= FREE_ATTEMPTS; attempt += 1) {
      service.signInWithOwnerPassword({ userId: OWNER.userId, password: "guess", deviceId: DEVICE, now: 101 });
    }
    const replacement = ["a", "different", "passphrase", "entirely"].join(" ");
    service.setOwnerPassword(OWNER.userId, replacement, 200);
    assert.equal(service.signInWithOwnerPassword({ userId: OWNER.userId, password: TEST_PHRASE, deviceId: DEVICE, now: 201 }).status, "REJECTED");
    assert.equal(service.signInWithOwnerPassword({ userId: OWNER.userId, password: replacement, deviceId: DEVICE, now: 202 }).status, "ISSUED");
  } finally { db.close(); }
});
