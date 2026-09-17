"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { handleOwnerPasswordChangeHttp, handleOwnerPasswordSignInHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");

const phrase = ["correct", "horse", "battery", "staple"].join(" ");
const device = ["nusa", "owner", "phone", "0001"].join("-");
const request = (body, authorization) => ({ method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify(body) });

function setup() {
  const db = new SqliteDatabase(":memory:");
  const users = new InMemoryNusaUserAccessRepository();
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  const session = new MobileSessionService(db, users);
  const dependencies = { sessionService: session, legacyTokenVerifier: { verify: () => undefined }, userAccessRepository: users };
  return { db, users, session, dependencies };
}

test("normal password sign-in infers exactly one owner and never accepts userId over HTTP", () => {
  const { db, users, session, dependencies } = setup();
  try {
    session.setOwnerPassword("owner", phrase, 1);
    const response = handleOwnerPasswordSignInHttp(request({ password: phrase, deviceId: device, userId: "not-used" }), dependencies);
    assert.equal(response.status, 200);
    users.ensureOwner({ id: "other-owner", email: "other@nusa.local" }, 2);
    assert.equal(session.signInWithOwnerPassword({ password: phrase, deviceId: device, now: 3 }).status, "AMBIGUOUS_OWNER");
  } finally { db.close(); }
});

test("zero owner fails closed and a password change requires a current active mobile owner session plus current password", () => {
  const emptyDb = new SqliteDatabase(":memory:");
  try {
    const empty = new MobileSessionService(emptyDb, new InMemoryNusaUserAccessRepository());
    assert.equal(empty.signInWithOwnerPassword({ password: phrase, deviceId: device, now: 1 }).status, "INVALID_OWNER");
  } finally { emptyDb.close(); }

  const { db, session, dependencies } = setup();
  try {
    const now = Date.now();
    session.setOwnerPassword("owner", phrase, now);
    const issued = session.signInWithOwnerPassword({ password: phrase, deviceId: device, now });
    assert.equal(issued.status, "ISSUED");
    const next = ["new", "owner", "password", "phrase"].join(" ");
    assert.equal(handleOwnerPasswordChangeHttp(request({ currentPassword: phrase, newPassword: next }), dependencies).status, 403);
    assert.equal(handleOwnerPasswordChangeHttp(request({ currentPassword: "wrong", newPassword: next }, "Bearer " + issued.tokens.accessToken), dependencies).status, 401);
    assert.equal(handleOwnerPasswordChangeHttp(request({ currentPassword: phrase, newPassword: next }, "Bearer " + issued.tokens.accessToken), dependencies).status, 200);
    assert.equal(session.signInWithOwnerPassword({ password: next, deviceId: device, now: now + 1 }).status, "ISSUED");
  } finally { db.close(); }
});
