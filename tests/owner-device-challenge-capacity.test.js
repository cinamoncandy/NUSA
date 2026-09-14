"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { OwnerDeviceCredentialService } = require("../dist/apps/cloud/src/ownerCredential/ownerDeviceCredentialService.js");

/**
 * `/v1/mobile/owner-device/authentication/challenge` needs no credential -- it cannot, since it is
 * how you authenticate -- and a credential id is an identifier rather than a secret: the phone
 * generates it, sends it to the server, and keeps it in SharedPreferences. WebAuthn treats
 * credential ids the same way. So anyone who learns one could reach the per-credential challenge
 * cap and, while the cap refused, keep the owner's own fingerprint out for the whole TTL by
 * refilling it.
 *
 * This is the third route in this repository with that shape, after PAPER pairing and the
 * pairing global cap. Evicting the oldest unconsumed challenge keeps the bound and keeps the
 * newest request; an evicted challenge costs only a restart, because each one is single-use and
 * useless without a signature over it.
 */

const OWNER = Object.freeze({ actorUserId: "owner", actorScopes: ["users:manage"] });
const DEVICE = "nusa-install-owners-phone";
const CREDENTIAL = "a".repeat(32);

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  const sessions = new MobileSessionService(db, users);
  const service = new OwnerDeviceCredentialService(db, users, sessions);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const signChallenge = (challenge) => sign("sha256", Buffer.from(challenge, "base64"), privateKey).toString("base64");
  return { db, service, publicKeySpki, signChallenge };
}

function registered(fixtureValue, credentialId = CREDENTIAL, deviceId = DEVICE) {
  const { service, publicKeySpki, signChallenge } = fixtureValue;
  const challenge = service.startRegistration({ ...OWNER, credentialId, deviceId, publicKeySpki, now: 1_000 });
  assert.equal(service.activateRegistration({ ...OWNER, challengeId: challenge.challengeId, credentialId, deviceId, signature: signChallenge(challenge.challenge), now: 1_001 }), true);
}

const liveChallenges = (db, now) =>
  Number(db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credential_challenges WHERE consumed_at IS NULL AND expires_at>?").get(now).count);

test("someone who knows the credential id cannot keep the owner's fingerprint out", () => {
  const context = fixture();
  try {
    registered(context);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_000 });
    }
    const owner = context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_001 });
    assert.ok(owner != null, "the owner's own device was refused a challenge");
    assert.equal(owner.purpose, "AUTHENTICATION");
  } finally {
    context.db.close();
  }
});

test("eviction keeps the table bounded rather than unbounded", () => {
  const context = fixture();
  try {
    registered(context);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_000 });
    }
    assert.ok(liveChallenges(context.db, 2_000) <= 2, `live challenges grew to ${liveChallenges(context.db, 2_000)}`);
  } finally {
    context.db.close();
  }
});

test("the newest challenge is the one that still works", () => {
  const context = fixture();
  try {
    registered(context);
    const stale = context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_000 });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_001 + attempt });
    }
    const newest = context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_010 });
    assert.ok(context.service.authenticate({ challengeId: newest.challengeId, credentialId: CREDENTIAL, deviceId: DEVICE, signature: context.signChallenge(newest.challenge), now: 2_011 }) != null);
    // The evicted one is gone rather than merely stale: a signature over it authenticates nobody.
    assert.equal(context.service.authenticate({ challengeId: stale.challengeId, credentialId: CREDENTIAL, deviceId: DEVICE, signature: context.signChallenge(stale.challenge), now: 2_012 }), undefined);
  } finally {
    context.db.close();
  }
});

test("an unknown credential still creates no challenge at all", () => {
  // The flood above needs a real credential id; an invented one must not even reach the table.
  const context = fixture();
  try {
    registered(context);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      assert.equal(context.service.startAuthentication({ credentialId: `b${"c".repeat(31)}`, deviceId: DEVICE, now: 2_000 }), undefined);
    }
    assert.ok(liveChallenges(context.db, 2_000) <= 2);
  } finally {
    context.db.close();
  }
});

test("registration still works, and a wrong signature never activates", () => {
  const context = fixture();
  try {
    const challenge = context.service.startRegistration({ ...OWNER, credentialId: CREDENTIAL, deviceId: DEVICE, publicKeySpki: context.publicKeySpki, now: 1_000 });
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const wrong = sign("sha256", Buffer.from(challenge.challenge, "base64"), other.privateKey).toString("base64");
    assert.equal(context.service.activateRegistration({ ...OWNER, challengeId: challenge.challengeId, credentialId: CREDENTIAL, deviceId: DEVICE, signature: wrong, now: 1_001 }), false);
    assert.equal(Number(context.db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credentials").get().count), 0);
  } finally {
    context.db.close();
  }
});

test("a signature over one credential's challenge does not authenticate another", () => {
  const context = fixture();
  try {
    registered(context);
    const second = fixture();
    try {
      registered(second, "d".repeat(32), "nusa-install-second-phone");
      const mine = context.service.startAuthentication({ credentialId: CREDENTIAL, deviceId: DEVICE, now: 2_000 });
      // Signed by the other device's key over this device's challenge.
      assert.equal(context.service.authenticate({ challengeId: mine.challengeId, credentialId: CREDENTIAL, deviceId: DEVICE, signature: second.signChallenge(mine.challenge), now: 2_001 }), undefined);
    } finally {
      second.db.close();
    }
  } finally {
    context.db.close();
  }
});
