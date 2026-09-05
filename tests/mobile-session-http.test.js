const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const {
  handleMobileBootstrapIssueHttp,
  handleMobileBootstrapHttp,
  handleMobileEnrollmentHttp,
  handleMobileSessionRefreshHttp,
  handleMobileSessionRevokeHttp,
  handleMobileMeHttp,
} = require("../dist/apps/cloud/src/mobileSessionHttp.js");

const OWNER_TOKEN = "owner-token-1234567890";
const USER_TOKEN = "approved-user-token-1234567890";

function setup() {
  const db = new SqliteDatabase(":memory:");
  const users = new InMemoryNusaUserAccessRepository();
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  users.registerUser({ id: "user", email: "user@nusa.local" }, 2);
  users.changeStatus({ actorUserId: "owner", targetUserId: "user", action: "APPROVE", now: 3 });
  const service = new MobileSessionService(db, users);
  const legacyTokenVerifier = {
    verify(token) {
      if (token === OWNER_TOKEN) return { userId: "owner", email: "owner@nusa.local", scopes: ["users:manage", "dashboard:read"] };
      if (token === USER_TOKEN) return { userId: "user", email: "user@nusa.local", scopes: ["dashboard:read", "paper:trade"] };
      return undefined;
    }
  };
  return { db, users, service, dependencies: { sessionService: service, legacyTokenVerifier, userAccessRepository: users } };
}

function issueUserBootstrap(service) {
  const now = Date.now();
  const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user", now });
  const tokens = service.bootstrap(issued.token, now, "test-device-1234");
  assert.ok(tokens);
  return tokens;
}

test("bootstrap issue is OWNER-only and validates the request", () => {
  const { db, dependencies } = setup();
  try {
    assert.equal(handleMobileBootstrapIssueHttp({ method: "GET", headers: {} }, dependencies).status, 405);
    assert.equal(handleMobileBootstrapIssueHttp({ method: "POST", headers: {} }, dependencies).status, 403);
    assert.equal(handleMobileBootstrapIssueHttp({ method: "POST", headers: { authorization: `Bearer ${USER_TOKEN}` } }, dependencies).status, 403);
    assert.equal(handleMobileBootstrapIssueHttp({
      method: "POST",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      body: JSON.stringify({}),
    }, dependencies).status, 400);
    const response = handleMobileBootstrapIssueHttp({
      method: "POST",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      body: JSON.stringify({ targetUserId: "user" }),
    }, dependencies);
    assert.equal(response.status, 201);
    assert.equal(typeof JSON.parse(response.body).token, "string");
  } finally { db.close(); }
});

test("bootstrap issue rejects suspended targets", () => {
  const { db, users, dependencies } = setup();
  try {
    users.changeStatus({ actorUserId: "owner", targetUserId: "user", action: "SUSPEND", now: 4 });
    const response = handleMobileBootstrapIssueHttp({
      method: "POST",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      body: JSON.stringify({ targetUserId: "user" }),
    }, dependencies);
    assert.equal(response.status, 409);
  } finally { db.close(); }
});

test("bootstrap consumes one-time tokens and rejects reuse", () => {
  const { db, service, dependencies } = setup();
  try {
    assert.equal(handleMobileBootstrapHttp({ method: "GET", headers: {} }, dependencies).status, 405);
    assert.equal(handleMobileBootstrapHttp({ method: "POST", headers: {}, body: "{}" }, dependencies).status, 400);
    assert.equal(handleMobileBootstrapHttp({
      method: "POST", headers: {}, body: JSON.stringify({ bootstrapToken: "bogus", deviceId: "test-device-1234" }),
    }, dependencies).status, 401);
    const issued = service.issueBootstrap({ actorUserId: "owner", targetUserId: "user", now: Date.now() });
    const first = handleMobileBootstrapHttp({
      method: "POST", headers: {}, body: JSON.stringify({ bootstrapToken: issued.token, deviceId: "test-device-1234" }),
    }, dependencies);
    assert.equal(first.status, 200);
    assert.ok(JSON.parse(first.body).accessToken);
    const second = handleMobileBootstrapHttp({
      method: "POST", headers: {}, body: JSON.stringify({ bootstrapToken: issued.token, deviceId: "test-device-1234" }),
    }, dependencies);
    assert.equal(second.status, 401);
  } finally { db.close(); }
});

test("refresh rotates tokens and rejects reuse", () => {
  const { db, service, dependencies } = setup();
  try {
    assert.equal(handleMobileSessionRefreshHttp({ method: "GET", headers: {} }, dependencies).status, 405);
    assert.equal(handleMobileSessionRefreshHttp({ method: "POST", headers: {}, body: "{}" }, dependencies).status, 400);
    assert.equal(handleMobileSessionRefreshHttp({
      method: "POST", headers: {}, body: JSON.stringify({ refreshToken: "bogus" }),
    }, dependencies).status, 401);
    const tokens = issueUserBootstrap(service);
    const rotated = handleMobileSessionRefreshHttp({
      method: "POST", headers: {}, body: JSON.stringify({ refreshToken: tokens.refreshToken, deviceId: "test-device-1234" }),
    }, dependencies);
    assert.equal(rotated.status, 200);
    assert.ok(JSON.parse(rotated.body).accessToken);
    const replay = handleMobileSessionRefreshHttp({
      method: "POST", headers: {}, body: JSON.stringify({ refreshToken: tokens.refreshToken, deviceId: "test-device-1234" }),
    }, dependencies);
    assert.equal(replay.status, 401);
  } finally { db.close(); }
});

test("revoke invalidates access and me reflects it", () => {  const { db, service, dependencies } = setup();
  try {
    assert.equal(handleMobileSessionRevokeHttp({ method: "GET", headers: {} }, dependencies).status, 405);
    assert.equal(handleMobileSessionRevokeHttp({ method: "POST", headers: {} }, dependencies).status, 401);
    assert.equal(handleMobileSessionRevokeHttp({
      method: "POST", headers: { authorization: "Bearer bogus" },
    }, dependencies).status, 401);
    assert.equal(handleMobileMeHttp({
      method: "POST", headers: { authorization: "Bearer bogus" },
    }, dependencies).status, 405);
    assert.equal(handleMobileMeHttp({ method: "GET", headers: {} }, dependencies).status, 401);
    const tokens = issueUserBootstrap(service);
    const auth = { authorization: `Bearer ${tokens.accessToken}` };
    const me = handleMobileMeHttp({ method: "GET", headers: auth }, dependencies);
    assert.equal(me.status, 200);
    assert.equal(JSON.parse(me.body).userId, "user");
    const revoked = handleMobileSessionRevokeHttp({ method: "POST", headers: auth }, dependencies);
    assert.equal(revoked.status, 200);
    assert.equal(JSON.parse(revoked.body).revoked, true);
    assert.equal(handleMobileMeHttp({ method: "GET", headers: auth }, dependencies).status, 401);
  } finally { db.close(); }
});

test("non-OWNER manage-scoped callers and throwing verifiers fail closed", () => {
  const { db, users, dependencies } = setup();
  try {
    users.registerUser({ id: "staff", email: "staff@nusa.local" }, 4);
    users.changeStatus({ actorUserId: "owner", targetUserId: "staff", action: "APPROVE", now: 5 });
    const staffVerifier = {
      verify(token) {
        return token === "staff-token" ? { userId: "staff", email: "staff@nusa.local", scopes: ["users:manage"] } : undefined;
      },
    };
    const staffDependencies = { ...dependencies, legacyTokenVerifier: staffVerifier };
    assert.equal(handleMobileBootstrapIssueHttp({
      method: "POST",
      headers: { authorization: "Bearer staff-token" },
      body: JSON.stringify({ targetUserId: "user" }),
    }, staffDependencies).status, 403);
    const throwingDependencies = {
      ...dependencies,
      legacyTokenVerifier: { verify() { throw new Error("directory down"); } },
    };
    assert.equal(handleMobileMeHttp({
      method: "GET", headers: { authorization: "Bearer anything" },
    }, throwingDependencies).status, 401);
    assert.equal(handleMobileSessionRevokeHttp({
      method: "POST", headers: { authorization: "Bearer anything" },
    }, throwingDependencies).status, 401);
  } finally { db.close(); }
});

test("service failures map to explicit HTTP codes without leaking internals", () => {
  const { db, dependencies } = setup();
  try {
    const auth = { authorization: `Bearer ${USER_TOKEN}` };
    const scopeFailing = {
      ...dependencies,
      sessionService: { issueSelfBootstrap() { throw new Error("invalid scope set"); } },
    };
    const scopeResponse = handleMobileEnrollmentHttp({
      method: "POST", headers: auth, body: JSON.stringify({ deviceId: "nusa-install-test-device-1234" }),
    }, scopeFailing);
    assert.equal(scopeResponse.status, 400);
    const activeFailing = {
      ...dependencies,
      sessionService: { issueSelfBootstrap() { throw new Error("user not ACTIVE"); } },
    };
    const activeResponse = handleMobileEnrollmentHttp({
      method: "POST", headers: auth, body: JSON.stringify({ deviceId: "nusa-install-test-device-1234" }),
    }, activeFailing);
    assert.equal(activeResponse.status, 403);
    const opaqueFailing = {
      ...dependencies,
      sessionService: { issueSelfBootstrap() { throw new Error("disk full"); } },
    };
    const opaqueResponse = handleMobileEnrollmentHttp({
      method: "POST", headers: auth, body: JSON.stringify({ deviceId: "nusa-install-test-device-1234" }),
    }, opaqueFailing);
    assert.equal(opaqueResponse.status, 403);
    assert.equal(JSON.parse(opaqueResponse.body).error, "MOBILE_ENROLLMENT_REJECTED");
    const revokeThrowing = {
      ...dependencies,
      sessionService: { verifyAccess() { throw new Error("store down"); }, revokeAccess() {} },
    };
    assert.equal(handleMobileSessionRevokeHttp({
      method: "POST", headers: auth,
    }, revokeThrowing).status, 503);
    const meThrowing = {
      ...dependencies,
      sessionService: { me() { throw new Error("store down"); } },
    };
    assert.equal(handleMobileMeHttp({
      method: "GET", headers: auth,
    }, meThrowing).status, 503);
  } finally { db.close(); }
});
