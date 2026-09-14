"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { OwnerDeviceCredentialService } = require("../dist/apps/cloud/src/ownerCredential/ownerDeviceCredentialService.js");
const httpApi = require("../dist/apps/cloud/src/mobileSessionHttp.js");

/**
 * The path the app actually takes, over HTTP, with the bearer the app actually holds.
 *
 * Every existing owner-device test authenticates registration with a legacy dashboard token. That
 * is the credential this whole effort exists to stop needing: in production the bearer is the
 * access token minted seconds earlier by password sign-in. Nothing covered that, so the primary
 * flow was only ever exercised in pieces.
 *
 * Timestamps here are real. Sessions expire against `Date.now()`, so a fixture that mints a token
 * at `now: 101` and then verifies it has built an expired token and is testing the expiry path by
 * accident -- which is how a first attempt at this read as a broken flow.
 */

const TEST_PHRASE = ["correct", "horse", "battery", "staple", "2026"].join("-");
const DEVICE = "nusa-install-owners-phone";
const CREDENTIAL = "a".repeat(32);

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const users = new SqliteNusaUserAccessRepository(db);
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "member", email: "member@example.com" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "member", action: "APPROVE", now: 3 });
  const sessionService = new MobileSessionService(db, users);
  const ownerDeviceCredentialService = new OwnerDeviceCredentialService(db, users, sessionService);
  const dependencies = Object.freeze({
    sessionService,
    ownerDeviceCredentialService,
    // Deliberately refuses everything: this test must pass without any legacy dashboard token.
    legacyTokenVerifier: Object.freeze({ verify: () => undefined }),
    userAccessRepository: users
  });
  return { db, users, sessionService, ownerDeviceCredentialService, dependencies };
}

const post = (body, bearer) => Object.freeze({
  method: "POST",
  headers: Object.freeze(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  body: JSON.stringify(body)
});

const json = (response) => JSON.parse(response.body);

function signOver(privateKey, challengeBase64) {
  return sign("sha256", Buffer.from(challengeBase64, "base64"), privateKey).toString("base64");
}

test("password sign-in, device registration and biometric authentication work over HTTP with no legacy token", () => {
  const context = fixture();
  try {
    context.sessionService.setOwnerPassword("owner", TEST_PHRASE, Date.now());

    const signedIn = httpApi.handleOwnerPasswordSignInHttp(post({ password: TEST_PHRASE, deviceId: DEVICE }), context.dependencies);
    assert.equal(signedIn.status, 200, signedIn.body);
    const bearer = json(signedIn).accessToken;
    assert.ok(bearer);

    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");

    // The bearer here is the session password sign-in just minted -- the only credential the app has.
    const challenge = httpApi.handleOwnerDeviceCredentialRegistrationChallengeHttp(
      post({ credentialId: CREDENTIAL, deviceId: DEVICE, publicKeySpki }, bearer), context.dependencies);
    assert.equal(challenge.status, 201, challenge.body);

    const activated = httpApi.handleOwnerDeviceCredentialRegistrationActivateHttp(
      post({ credentialId: CREDENTIAL, deviceId: DEVICE, challengeId: json(challenge).challengeId, signature: signOver(privateKey, json(challenge).challenge) }, bearer),
      context.dependencies);
    assert.equal(activated.status, 201, activated.body);

    // From here the password is never used again: the fingerprint signs a server challenge.
    const authChallenge = httpApi.handleOwnerDeviceCredentialAuthenticationChallengeHttp(
      post({ credentialId: CREDENTIAL, deviceId: DEVICE }), context.dependencies);
    assert.equal(authChallenge.status, 201, authChallenge.body);

    const authenticated = httpApi.handleOwnerDeviceCredentialAuthenticationCompleteHttp(
      post({ credentialId: CREDENTIAL, deviceId: DEVICE, challengeId: json(authChallenge).challengeId, signature: signOver(privateKey, json(authChallenge).challenge) }),
      context.dependencies);
    assert.equal(authenticated.status, 200, authenticated.body);
    assert.ok(json(authenticated).accessToken, "biometric authentication issued no session");
    assert.notEqual(json(authenticated).accessToken, bearer, "the biometric session must be its own, not a replay of the password one");
  } finally {
    context.db.close();
  }
});

test("a biometric session carries the same authority as the password session that enrolled it", () => {
  // If the two differed, the owner would silently lose a capability the day they stopped typing
  // their password -- the failure would show up as a 403 on a screen that worked yesterday.
  const context = fixture();
  try {
    context.sessionService.setOwnerPassword("owner", TEST_PHRASE, Date.now());
    const bearer = json(httpApi.handleOwnerPasswordSignInHttp(post({ password: TEST_PHRASE, deviceId: DEVICE }), context.dependencies)).accessToken;
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const challenge = json(httpApi.handleOwnerDeviceCredentialRegistrationChallengeHttp(post({ credentialId: CREDENTIAL, deviceId: DEVICE, publicKeySpki }, bearer), context.dependencies));
    httpApi.handleOwnerDeviceCredentialRegistrationActivateHttp(post({ credentialId: CREDENTIAL, deviceId: DEVICE, challengeId: challenge.challengeId, signature: signOver(privateKey, challenge.challenge) }, bearer), context.dependencies);
    const authChallenge = json(httpApi.handleOwnerDeviceCredentialAuthenticationChallengeHttp(post({ credentialId: CREDENTIAL, deviceId: DEVICE }), context.dependencies));
    const biometric = json(httpApi.handleOwnerDeviceCredentialAuthenticationCompleteHttp(
      post({ credentialId: CREDENTIAL, deviceId: DEVICE, challengeId: authChallenge.challengeId, signature: signOver(privateKey, authChallenge.challenge) }), context.dependencies));

    const passwordScopes = [...context.sessionService.verifyAccess(bearer).scopes].sort();
    const biometricScopes = [...context.sessionService.verifyAccess(biometric.accessToken).scopes].sort();
    assert.deepEqual(biometricScopes, passwordScopes);
    assert.ok(passwordScopes.includes("users:manage"), "an owner must be able to approve devices from their phone");
  } finally {
    context.db.close();
  }
});

test("a member's phone session never carries owner authority", () => {
  // MOBILE_ALLOWED_SCOPES includes users:manage so the owner can approve from their phone. Nothing
  // pinned that the scope is granted by role rather than to every mobile session.
  const context = fixture();
  try {
    const pairing = context.sessionService.startPairing("nusa-install-members-phone", Date.now());
    assert.equal(context.sessionService.approvePairing({
      actorUserId: "owner", actorScopes: ["users:manage"], targetUserId: "member",
      requestId: pairing.requestId, verificationCode: pairing.verificationCode, now: Date.now()
    }), true);
    const tokens = context.sessionService.exchangePairing(pairing.requestId, "nusa-install-members-phone", Date.now());
    assert.ok(tokens);
    assert.deepEqual([...tokens.scopes].sort(), ["dashboard:read", "paper:trade"]);
    assert.equal(tokens.scopes.includes("users:manage"), false, "a member's phone was handed user management");
  } finally {
    context.db.close();
  }
});

test("registration refuses a member's session even though it is a valid session", () => {
  const context = fixture();
  try {
    const pairing = context.sessionService.startPairing("nusa-install-members-phone", Date.now());
    context.sessionService.approvePairing({
      actorUserId: "owner", actorScopes: ["users:manage"], targetUserId: "member",
      requestId: pairing.requestId, verificationCode: pairing.verificationCode, now: Date.now()
    });
    const tokens = context.sessionService.exchangePairing(pairing.requestId, "nusa-install-members-phone", Date.now());
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const refused = httpApi.handleOwnerDeviceCredentialRegistrationChallengeHttp(
      post({ credentialId: "b".repeat(32), deviceId: "nusa-install-members-phone", publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64") }, tokens.accessToken),
      context.dependencies);
    assert.equal(refused.status, 403, refused.body);
  } finally {
    context.db.close();
  }
});
