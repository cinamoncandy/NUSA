const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

const OWNER_TOKEN = "owner-session-boundary-token";
const USER_TOKEN = "desktop-user-bootstrap-identity-token";
const OWNER = Object.freeze({
  userId: "operator",
  email: "owner@nusa.local",
  displayName: "NUSA Owner",
  scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"])
});
const USER = Object.freeze({
  userId: "desktop-user",
  email: "desktop.user@example.com",
  displayName: "Desktop User",
  scopes: Object.freeze(["dashboard:read", "paper:trade"])
});
const verifier = Object.freeze({
  ownerPrincipal: OWNER,
  verify(token) {
    if (token === OWNER_TOKEN) return OWNER;
    if (token === USER_TOKEN) return USER;
    return undefined;
  }
});

function httpRequest(port, method, path, { token, body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        connection: "close",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        ...headers
      }
    }, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const json = (response) => JSON.parse(response.body);

async function approveUser(port) {
  const pendingProbe = await httpRequest(port, "GET", "/api/dashboard", { token: USER_TOKEN });
  assert.equal(pendingProbe.status, 401, "first-seen ordinary identity must remain PENDING");

  const approved = await httpRequest(port, "POST", "/api/operator/users", {
    token: OWNER_TOKEN,
    body: { targetUserId: USER.userId, action: "APPROVE", reason: "desktop session E2E" }
  });
  assert.equal(approved.status, 200);
  assert.equal(json(approved).user.status, "ACTIVE");
}

async function issueAndConsumeBootstrap(port) {
  const issued = await httpRequest(port, "POST", "/api/operator/desktop-bootstrap", {
    token: OWNER_TOKEN,
    body: { targetUserId: USER.userId, scopes: ["dashboard:read", "paper:trade"] }
  });
  assert.equal(issued.status, 201);
  const bootstrap = json(issued);
  assert.equal(bootstrap.targetUserId, USER.userId);
  assert.deepEqual(bootstrap.scopes, ["dashboard:read", "paper:trade"]);
  assert.equal(typeof bootstrap.token, "string");
  assert.ok(bootstrap.token.length >= 32);

  const consumed = await httpRequest(port, "POST", "/v1/desktop/bootstrap", {
    body: { bootstrapToken: bootstrap.token }
  });
  assert.equal(consumed.status, 200);
  const session = json(consumed);
  assert.equal(typeof session.accessToken, "string");
  assert.equal(typeof session.refreshToken, "string");
  assert.notEqual(session.accessToken, session.refreshToken);
  assert.deepEqual(session.scopes, ["dashboard:read", "paper:trade"]);

  const replay = await httpRequest(port, "POST", "/v1/desktop/bootstrap", {
    body: { bootstrapToken: bootstrap.token }
  });
  assert.equal(replay.status, 401, "bootstrap token must be single-use");
  return session;
}

test("Desktop Cloud session works end-to-end over the real HTTP server and fails closed on reuse/revoke/suspension", async () => {
  const port = 41954;
  const handle = startCloudDashboardServer({
    port,
    tokenVerifier: verifier,
    loadDashboard: (principal) => Object.freeze({
      marker: "desktop-session-dashboard",
      userId: principal.userId,
      liveAuthority: "NONE",
      productionMutationAllowed: false
    }),
    loadPaperOperations: (principal) => Object.freeze({
      marker: "desktop-session-paper-operations",
      userId: principal.userId,
      liveAuthority: "NONE",
      productionMutationAllowed: false
    }),
    submitPaperOrder: () => Object.freeze({
      schemaVersion: 1,
      status: "BLOCKED",
      reason: "E2E_AUTHORIZATION_PROBE",
      liveAuthority: "NONE",
      productionMutationAllowed: false
    })
  });

  try {
    await approveUser(port);

    const first = await issueAndConsumeBootstrap(port);

    const me = await httpRequest(port, "GET", "/v1/desktop/me", { token: first.accessToken });
    assert.equal(me.status, 200);
    const identity = json(me);
    assert.equal(identity.userId, USER.userId);
    assert.equal(identity.email, USER.email);
    assert.deepEqual(identity.scopes, ["dashboard:read", "paper:trade"]);
    assert.equal("accessToken" in identity, false);
    assert.equal("refreshToken" in identity, false);
    assert.equal("bootstrapToken" in identity, false);

    const dashboard = await httpRequest(port, "GET", "/api/dashboard", { token: first.accessToken });
    assert.equal(dashboard.status, 200);
    assert.equal(json(dashboard).marker, "desktop-session-dashboard");
    assert.equal(json(dashboard).userId, USER.userId);

    const operations = await httpRequest(port, "GET", "/api/paper-operations", { token: first.accessToken });
    assert.equal(operations.status, 200);
    assert.equal(json(operations).marker, "desktop-session-paper-operations");
    assert.equal(json(operations).liveAuthority, "NONE");
    assert.equal(json(operations).productionMutationAllowed, false);

    const command = {
      schemaVersion: 1,
      authority: "PAPER_ONLY",
      productionMutationAllowed: false,
      idempotencyKey: "desktop-session-e2e-order-0001",
      market: "KRW-BTC",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.001
    };
    const paperTrade = await httpRequest(port, "POST", "/api/paper-orders", {
      token: first.accessToken,
      body: command,
      headers: { "idempotency-key": command.idempotencyKey }
    });
    assert.equal(paperTrade.status, 200, "desktop access token must carry PAPER-only trade scope");
    const paperResult = json(paperTrade);
    assert.equal(paperResult.status, "BLOCKED");
    assert.equal(paperResult.reason, "E2E_AUTHORIZATION_PROBE");
    assert.equal(paperResult.liveAuthority, "NONE");
    assert.equal(paperResult.productionMutationAllowed, false);

    const refreshedResponse = await httpRequest(port, "POST", "/v1/desktop/session/refresh", {
      body: { refreshToken: first.refreshToken }
    });
    assert.equal(refreshedResponse.status, 200);
    const refreshed = json(refreshedResponse);
    assert.notEqual(refreshed.accessToken, first.accessToken);
    assert.notEqual(refreshed.refreshToken, first.refreshToken);

    const refreshReplay = await httpRequest(port, "POST", "/v1/desktop/session/refresh", {
      body: { refreshToken: first.refreshToken }
    });
    assert.equal(refreshReplay.status, 401, "consumed refresh reuse must be rejected");

    const familyRevoked = await httpRequest(port, "GET", "/v1/desktop/me", { token: refreshed.accessToken });
    assert.equal(familyRevoked.status, 401, "refresh reuse must revoke the whole session family");
    const rotatedRefreshRevoked = await httpRequest(port, "POST", "/v1/desktop/session/refresh", {
      body: { refreshToken: refreshed.refreshToken }
    });
    assert.equal(rotatedRefreshRevoked.status, 401);

    const second = await issueAndConsumeBootstrap(port);
    const revoked = await httpRequest(port, "POST", "/v1/desktop/session/revoke", { token: second.accessToken });
    assert.equal(revoked.status, 200);
    assert.equal(json(revoked).revoked, true);
    assert.equal((await httpRequest(port, "GET", "/api/dashboard", { token: second.accessToken })).status, 401);
    assert.equal((await httpRequest(port, "POST", "/v1/desktop/session/refresh", { body: { refreshToken: second.refreshToken } })).status, 401);

    const third = await issueAndConsumeBootstrap(port);
    const suspended = await httpRequest(port, "POST", "/api/operator/users", {
      token: OWNER_TOKEN,
      body: { targetUserId: USER.userId, action: "SUSPEND", reason: "desktop session E2E suspension" }
    });
    assert.equal(suspended.status, 200);
    assert.equal(json(suspended).user.status, "SUSPENDED");
    assert.equal((await httpRequest(port, "GET", "/api/dashboard", { token: third.accessToken })).status, 401, "durable suspension must block an already-issued desktop access token immediately");
    assert.equal((await httpRequest(port, "POST", "/v1/desktop/session/refresh", { body: { refreshToken: third.refreshToken } })).status, 401, "durable suspension must block refresh and revoke its family");
  } finally {
    await handle.stop();
  }
});
