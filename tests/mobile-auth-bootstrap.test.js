const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  InMemoryMobileEnrollmentRepository,
  InMemoryMobileSessionRepository,
  MobileAuthError,
  MobileSessionAuthority
} = require("../dist/apps/cloud/src/mobileAuth.js");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { InMemoryInvestmentAllocationSettingsRepository } = require("../dist/apps/cloud/src/cloudInvestmentAllocationSettings.js");

const OPERATOR_TOKEN = "operator-token";
const operatorPrincipal = Object.freeze({ userId: "owner-1", email: "owner@example.com", scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage", "settings:read", "settings:write"]) });
const operatorVerifier = Object.freeze({ ownerPrincipal: operatorPrincipal, verify(token) { return token === OPERATOR_TOKEN ? operatorPrincipal : undefined; } });
const dashboard = Object.freeze({ mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" });
const clock = { now: 1_000_000 };

function authority() {
  return new MobileSessionAuthority(
    new InMemoryMobileEnrollmentRepository([{ proof: "enrollment-proof-that-is-never-stored-as-a-token", userId: "mobile-user", email: "mobile@example.com", deviceId: "device-1", expiresAtMs: 10_000_000 }]),
    new InMemoryMobileSessionRepository(),
    { accessLifetimeMs: 100, refreshLifetimeMs: 1_000, now: () => clock.now }
  );
}

function request(port, path, method = "GET", body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { connection: "close", ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }), ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

test("mobile enrollment is one-time and issues a short-lived mobile-only session", () => {
  const auth = authority();
  const issue = auth.bootstrap({ proof: "enrollment-proof-that-is-never-stored-as-a-token", deviceId: "device-1" });
  assert.equal(issue.audience, "nusa-mobile");
  assert.ok(issue.accessToken.length > 30);
  assert.ok(issue.refreshToken.length > 30);
  assert.deepEqual([...issue.scopes], ["paper:read", "paper:simulate", "portfolio:read", "history:read", "ai:read", "broker:read"]);
  const principal = auth.verifyAccess(issue.accessToken);
  assert.equal(principal.authDomain, "MOBILE");
  assert.equal(principal.scopes.includes("settings:write"), false);
  assert.equal(principal.scopes.includes("live:trade"), false);
  assert.throws(() => auth.bootstrap({ proof: "enrollment-proof-that-is-never-stored-as-a-token", deviceId: "device-1" }), (error) => error instanceof MobileAuthError && error.code === "BOOTSTRAP_DENIED");
});

test("refresh rotates the refresh credential, expiry and revoke fail closed", () => {
  const auth = authority();
  const first = auth.bootstrap({ proof: "enrollment-proof-that-is-never-stored-as-a-token", deviceId: "device-1" });
  clock.now += 101;
  const second = auth.refresh(first.refreshToken);
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal(auth.verifyAccess(first.accessToken), undefined);
  assert.throws(() => auth.refresh(first.refreshToken), (error) => error instanceof MobileAuthError && error.code === "AUTH_REQUIRED");
  auth.revokeAccess(second.accessToken);
  assert.equal(auth.verifyAccess(second.accessToken), undefined);
  assert.throws(() => auth.refresh(second.refreshToken), (error) => error instanceof MobileAuthError && error.code === "SESSION_REVOKED");
});

test("mobile HTTP bootstrap can read PAPER but cannot enter operator settings/users routes", async () => {
  clock.now = 1_000_000;
  const mobile = authority();
  const server = startCloudDashboardServer({
    port: 41991,
    tokenVerifier: operatorVerifier,
    mobileAuth: { authority: mobile },
    loadDashboard: () => dashboard,
    loadPaperOperations: () => ({ dashboard, operations: { runtimeState: "READY_OFFLINE" }, liveAuthority: "NONE", productionMutationAllowed: false }),
    investmentAllocationSettings: new InMemoryInvestmentAllocationSettingsRepository()
  });
  try {
    const issue = await request(server.port, "/api/mobile/session/bootstrap", "POST", { proof: "enrollment-proof-that-is-never-stored-as-a-token", deviceId: "device-1" });
    assert.equal(issue.status, 200);
    const access = issue.body.accessToken;
    const paper = await request(server.port, "/api/paper-operations", "GET", undefined, { authorization: `Bearer ${access}` });
    assert.equal(paper.status, 200);
    const users = await request(server.port, "/api/operator/users", "GET", undefined, { authorization: `Bearer ${access}` });
    assert.equal(users.status, 403);
    const settings = await request(server.port, "/api/settings/investment-allocation", "GET", undefined, { authorization: `Bearer ${access}` });
    assert.equal(settings.status, 403);
    const revoked = await request(server.port, "/api/mobile/session/revoke", "POST", {}, { authorization: `Bearer ${access}` });
    assert.equal(revoked.status, 200);
    const after = await request(server.port, "/api/paper-operations", "GET", undefined, { authorization: `Bearer ${access}` });
    assert.equal(after.status, 401);
  } finally {
    await server.stop();
  }
});

test("operator bearer cannot be used at mobile bootstrap refresh or revoke", async () => {
  const mobile = authority();
  const server = startCloudDashboardServer({ port: 41992, tokenVerifier: operatorVerifier, mobileAuth: { authority: mobile }, loadDashboard: () => dashboard });
  try {
    const revoke = await request(server.port, "/api/mobile/session/revoke", "POST", {}, { authorization: `Bearer ${OPERATOR_TOKEN}` });
    assert.equal(revoke.status, 401);
  } finally {
    await server.stop();
  }
});
