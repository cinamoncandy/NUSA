const test = require("node:test");
const assert = require("node:assert/strict");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const OWNER_TOKEN = "cloud-runtime-mobile-session-owner-token-123456";

function request(port, method, path, { token, body } = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("startCloudRuntime wires mobile sessions into the durable HTTP routes", async () => {
  const port = 41961;
  const handle = startCloudRuntime({
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: OWNER_TOKEN,
    NUSA_CLOUD_STATE_DB_PATH: ":memory:",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_OWNER_ID: "mobile-runtime-owner",
    NUSA_OWNER_EMAIL: "mobile-runtime-owner@nusa.local"
  });

  try {
    const unauthenticatedMe = await request(port, "GET", "/v1/mobile/me");
    assert.equal(unauthenticatedMe.status, 401);

    const issued = await request(port, "POST", "/api/operator/mobile-bootstrap", {
      token: OWNER_TOKEN,
      body: { targetUserId: "mobile-runtime-owner", scopes: ["dashboard:read", "paper:trade"] }
    });
    assert.equal(issued.status, 201);
    assert.equal(typeof issued.body.token, "string");

    const bootstrapped = await request(port, "POST", "/v1/mobile/bootstrap", { body: { bootstrapToken: issued.body.token } });
    assert.equal(bootstrapped.status, 200);
    assert.deepEqual(bootstrapped.body.scopes, ["dashboard:read", "paper:trade"]);

    const me = await request(port, "GET", "/v1/mobile/me", { token: bootstrapped.body.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.userId, "mobile-runtime-owner");
    assert.equal("accessToken" in me.body, false);
    assert.equal("refreshToken" in me.body, false);

    const paper = await request(port, "GET", "/api/paper-operations", { token: bootstrapped.body.accessToken });
    assert.equal(paper.status, 200);
    assert.equal(paper.body.liveAuthority, "NONE");
    assert.equal(paper.body.productionMutationAllowed, false);

    const refreshed = await request(port, "POST", "/v1/mobile/session/refresh", { body: { refreshToken: bootstrapped.body.refreshToken } });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.accessToken, bootstrapped.body.accessToken);

    const revoked = await request(port, "POST", "/v1/mobile/session/revoke", { token: refreshed.body.accessToken });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked, true);
    assert.equal((await request(port, "GET", "/v1/mobile/me", { token: refreshed.body.accessToken })).status, 401);
    assert.equal((await request(port, "POST", "/v1/mobile/session/refresh", { body: { refreshToken: refreshed.body.refreshToken } })).status, 401);
  } finally {
    await handle.stop();
  }
});
