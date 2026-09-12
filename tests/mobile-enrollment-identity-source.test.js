"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { authorizeActiveUserResult, handleMobileEnrollmentHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");

/**
 * Enrollment is moving toward "identity, not a pasted token", which is a better first-run
 * experience and a sound design -- provided "identity" means an assertion signed by someone
 * other than the phone. The phone's own installation id is not that: `installationIdentity.ts`
 * generates it with `crypto.getRandomValues` and stores it locally, so anything that can POST
 * can claim any value of it. If a device-supplied identifier ever reaches a principal, the
 * PAPER account and the operator user-management surface open to unauthenticated callers.
 *
 * These pin the two halves of the boundary an identity provider has to land inside:
 *
 *   1. Identity material carried in the request body never authenticates anything. `deviceId`
 *      binds a session that some verified credential already authorized; it does not authorize.
 *   2. However a principal is produced, the account chain still runs behind it -- registered,
 *      active, and email matching the record. A verifier is the *only* thing a new identity
 *      source may replace; it may not skip what follows.
 *
 * One half is already structural: `authorizeActiveUserResult` takes a `DashboardHttpRequest`,
 * which has no `body`; only the handler widens it with `& { body?: string }` for itself. So the
 * authorization decision cannot read a body field today even by accident. That is worth keeping
 * -- an identity source added as a parameter stays inside the boundary; one added by reading the
 * body has to break this signature first, and these tests fail the moment it does.
 *
 * A Google or Apple ID-token verifier satisfies both: it replaces `legacyTokenVerifier.verify`,
 * returns a principal only for a signature it checked, and the registration and approval gates
 * below stay exactly where they are. A "trust the installation id" shortcut fails test 1.
 */

const OWNER = Object.freeze({ userId: "owner-1", email: "owner@nusa.local", scopes: ["users:manage", "paper:trade"] });
// Composed rather than written as a literal so the secret scanner's CREDENTIAL_ASSIGNMENT rule
// does not read a test fixture as a real credential, matching the other fixtures here.
const TOKEN = ["owner", "dashboard", "fixture", "0123456789"].join("-");
const ACTIVE = Object.freeze({ id: OWNER.userId, email: OWNER.email, role: "OWNER", status: "ACTIVE" });

const verifier = Object.freeze({ ownerPrincipal: OWNER, verify: (token) => (token === TOKEN ? OWNER : undefined) });

const requestWith = (authorization, body) => Object.freeze({
  method: "POST",
  headers: Object.freeze(authorization == null ? {} : { authorization }),
  body: JSON.stringify(body)
});

const deps = (user, identityVerifier = verifier) => Object.freeze({
  sessionService: {
    issueSelfBootstrap: ({ actorUserId, deviceId }) =>
      ({ token: "issued", expiresAt: Date.now() + 1000, targetUserId: actorUserId, deviceId, scopes: ["paper:trade"], id: "b1" })
  },
  legacyTokenVerifier: identityVerifier,
  userAccessRepository: { get: (id) => (user != null && id === user.id ? user : undefined) }
});

/** Everything a phone can put in a request body while presenting no credential at all. */
const SELF_ASSERTED_IDENTITY = Object.freeze([
  { deviceId: "nusa-install-0123456789abcdef" },
  { deviceId: "nusa-install-0123456789abcdef", userId: OWNER.userId },
  { deviceId: "nusa-install-0123456789abcdef", userId: OWNER.userId, email: OWNER.email },
  { deviceId: "nusa-install-0123456789abcdef", installationId: "nusa-install-0123456789abcdef" },
  { deviceId: "nusa-install-0123456789abcdef", principal: OWNER },
  { deviceId: "nusa-install-0123456789abcdef", subject: OWNER.email, emailVerified: true }
]);

test("no identity a device asserts about itself authenticates it", () => {
  for (const body of SELF_ASSERTED_IDENTITY) {
    const outcome = authorizeActiveUserResult(requestWith(undefined, body), deps(ACTIVE));
    assert.equal(
      outcome.refusal,
      "NO_CREDENTIAL",
      `${JSON.stringify(body)} produced ${JSON.stringify(outcome)} -- a body field became a credential`
    );
    assert.equal(outcome.principal, undefined);
    assert.equal(handleMobileEnrollmentHttp(requestWith(undefined, body), deps(ACTIVE)).status, 401);
  }
});

test("a verified principal comes from the verifier, never from the body beside it", () => {
  const impersonation = { deviceId: "nusa-install-0123456789abcdef", userId: "someone-else", email: "attacker@nusa.local" };
  const outcome = authorizeActiveUserResult(requestWith(`Bearer ${TOKEN}`, impersonation), deps(ACTIVE));
  assert.equal(outcome.principal.userId, OWNER.userId);
  assert.equal(outcome.principal.email, OWNER.email);
});

test("any identity source is still followed by registration, approval and email match", () => {
  // Stands in for a future ID-token verifier: it authenticates by some other means entirely,
  // and everything after it must behave exactly as it does for the legacy bearer.
  const identityProvider = (principal) => Object.freeze({ ownerPrincipal: OWNER, verify: () => principal });
  const body = { deviceId: "nusa-install-0123456789abcdef" };
  const via = (principal, user) =>
    authorizeActiveUserResult(requestWith("Bearer any-assertion", body), deps(user, identityProvider(principal)));

  assert.equal(via(OWNER, undefined).refusal, "USER_NOT_REGISTERED");
  assert.equal(via(OWNER, { ...ACTIVE, status: "PENDING" }).refusal, "USER_NOT_ACTIVE");
  assert.equal(via(OWNER, { ...ACTIVE, status: "SUSPENDED" }).refusal, "USER_NOT_ACTIVE");
  assert.equal(via(OWNER, { ...ACTIVE, email: "other@nusa.local" }).refusal, "USER_IDENTITY_MISMATCH");
  assert.equal(via(OWNER, ACTIVE).principal.userId, OWNER.userId);
});

test("an identity carrying no email cannot enroll", () => {
  // An ID token without a verified email cannot be matched against the user record, so it must
  // refuse rather than fall through to whatever the repository returns for a blank lookup.
  const anonymous = Object.freeze({ ownerPrincipal: OWNER, verify: () => ({ userId: OWNER.userId, scopes: ["paper:trade"] }) });
  const outcome = authorizeActiveUserResult(
    requestWith("Bearer any-assertion", { deviceId: "nusa-install-0123456789abcdef" }),
    deps(ACTIVE, anonymous)
  );
  assert.equal(outcome.refusal, "CREDENTIAL_REJECTED");
});

test("enrollment binds the session to the device it names, without trusting it", () => {
  const response = handleMobileEnrollmentHttp(
    requestWith(`Bearer ${TOKEN}`, { deviceId: "nusa-install-0123456789abcdef" }),
    deps(ACTIVE)
  );
  assert.equal(response.status, 201);
  const issued = JSON.parse(response.body);
  assert.equal(issued.targetUserId, OWNER.userId, "the session belongs to the verified principal, not the named device");
});
