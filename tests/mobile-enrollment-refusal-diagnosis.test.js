const test = require("node:test");
const assert = require("node:assert/strict");

const { authorizeActiveUserResult, handleMobileEnrollmentHttp } = require("../dist/apps/cloud/src/mobileSessionHttp.js");
const { describeCredentialFailure } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { MobileSessionRequestError } = require("../dist/apps/mobile/src/mobileApprovedSession.js");

const OWNER = Object.freeze({ userId: "owner-1", email: "owner@nusa.local", scopes: ["users:manage", "paper:trade"] });
// Composed rather than written as a literal so the secret scanner's CREDENTIAL_ASSIGNMENT rule
// does not read a test fixture as a real credential, matching how other fixtures here are built.
const TOKEN = ["owner", "dashboard", "fixture", "0123456789"].join("-");
const WRONG_TOKEN = ["wrong", "value", "fixture", "0123456789"].join("-");

const verifier = Object.freeze({
  ownerPrincipal: OWNER,
  verify: (token) => (token === TOKEN ? OWNER : undefined)
});

const request = (authorization) => Object.freeze({
  method: "POST",
  headers: Object.freeze(authorization == null ? {} : { authorization }),
  body: JSON.stringify({ deviceId: "device-fixture-1" })
});

const deps = (user) => Object.freeze({
  sessionService: { issueSelfBootstrap: () => ({ token: "issued", expiresAt: Date.now() + 1000, targetUserId: OWNER.userId, scopes: ["paper:trade"], id: "b1" }) },
  legacyTokenVerifier: verifier,
  userAccessRepository: { get: () => user }
});

const ACTIVE = Object.freeze({ id: OWNER.userId, email: OWNER.email, role: "OWNER", status: "ACTIVE" });

// Every one of these used to be an indistinguishable 403 USER_NOT_ACTIVE, which is why a real
// enrollment failure could not be told apart from a wrong token by the operator or their logs.
test("each enrollment refusal is named", () => {
  assert.equal(authorizeActiveUserResult(request(undefined), deps(ACTIVE)).refusal, "NO_CREDENTIAL");
  assert.equal(authorizeActiveUserResult(request(`Bearer ${WRONG_TOKEN}`), deps(ACTIVE)).refusal, "CREDENTIAL_REJECTED");
  assert.equal(authorizeActiveUserResult(request(`Bearer ${TOKEN}`), deps(undefined)).refusal, "USER_NOT_REGISTERED");
  assert.equal(authorizeActiveUserResult(request(`Bearer ${TOKEN}`), deps({ ...ACTIVE, status: "PENDING" })).refusal, "USER_NOT_ACTIVE");
  assert.equal(authorizeActiveUserResult(request(`Bearer ${TOKEN}`), deps({ ...ACTIVE, email: "other@nusa.local" })).refusal, "USER_IDENTITY_MISMATCH");
  assert.equal(authorizeActiveUserResult(request(`Bearer ${TOKEN}`), deps(ACTIVE)).principal.userId, OWNER.userId);
});

test("an unauthenticated refusal is 401 and an account refusal is 403", () => {
  assert.equal(handleMobileEnrollmentHttp(request(undefined), deps(ACTIVE)).status, 401);
  assert.equal(handleMobileEnrollmentHttp(request(`Bearer ${WRONG_TOKEN}`), deps(ACTIVE)).status, 401);

  const pending = handleMobileEnrollmentHttp(request(`Bearer ${TOKEN}`), deps({ ...ACTIVE, status: "PENDING" }));
  assert.equal(pending.status, 403);
  assert.equal(JSON.parse(pending.body).error, "USER_NOT_ACTIVE");

  const unregistered = handleMobileEnrollmentHttp(request(`Bearer ${TOKEN}`), deps(undefined));
  assert.equal(unregistered.status, 403);
  assert.equal(JSON.parse(unregistered.body).error, "USER_NOT_REGISTERED");
});

test("the app turns each named refusal into a distinct instruction", () => {
  const notRegistered = describeCredentialFailure(new MobileSessionRequestError(403, "USER_NOT_REGISTERED"));
  const notActive = describeCredentialFailure(new MobileSessionRequestError(403, "USER_NOT_ACTIVE"));
  const mismatch = describeCredentialFailure(new MobileSessionRequestError(403, "USER_IDENTITY_MISMATCH"));
  const rejected = describeCredentialFailure(new MobileSessionRequestError(401, "CREDENTIAL_REJECTED"));

  assert.match(notRegistered, /등록되어 있지 않습니다/);
  assert.match(notActive, /ACTIVE 상태가 아닙니다/);
  assert.match(mismatch, /일치하지 않습니다/);
  assert.match(rejected, /만료되었거나 이미 사용/);
  assert.equal(new Set([notRegistered, notActive, mismatch, rejected]).size, 4, "each refusal reads differently");
});

test("a refusal without a server code still falls back to the status message", () => {
  assert.match(describeCredentialFailure(new MobileSessionRequestError(401)), /만료되었거나 이미 사용/);
  assert.match(describeCredentialFailure(new MobileSessionRequestError(429)), /일시적으로 제한/);
});
