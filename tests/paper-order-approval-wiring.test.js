const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");

const command = {
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "approval-wiring-0001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001
};

function post(port, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(command);
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/api/paper-orders",
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "idempotency-key": command.idempotencyKey,
        connection: "close"
      }
    }, (response) => {
      let payload = "";
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(payload) }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("PAPER order server requires ACTIVE approval and paper:trade scope", async () => {
  const users = new InMemoryNusaUserAccessRepository();
  users.ensureOwner({ id: "operator", email: "operator@nusa.local" }, 1);
  users.registerUser({ id: "pending-user", email: "pending@nusa.local" }, 2);
  users.registerUser({ id: "active-user", email: "active@nusa.local" }, 3);
  users.changeStatus({ actorUserId: "operator", targetUserId: "active-user", action: "APPROVE", now: 4 });

  let submissions = 0;
  const server = startCloudDashboardServer({
    port: 41912,
    userAccessRepository: users,
    tokenVerifier: {
      verify(token) {
        if (token === "pending-token") return { userId: "pending-user", scopes: ["paper:trade"] };
        if (token === "active-token") return { userId: "active-user", scopes: ["paper:trade"] };
        if (token === "read-only-token") return { userId: "active-user", scopes: ["dashboard:read"] };
        return undefined;
      }
    },
    loadDashboard: () => ({ mode: "PAPER" }),
    submitPaperOrder: () => {
      submissions += 1;
      return { schemaVersion: 1, status: "BLOCKED", reason: "TEST_ONLY", liveAuthority: "NONE", productionMutationAllowed: false };
    }
  });

  try {
    const pending = await post(server.port, "pending-token");
    assert.equal(pending.status, 401);
    const readOnly = await post(server.port, "read-only-token");
    assert.equal(readOnly.status, 403);
    const active = await post(server.port, "active-token");
    assert.equal(active.status, 200);
    assert.equal(active.body.liveAuthority, "NONE");
    assert.equal(active.body.productionMutationAllowed, false);
    assert.equal(submissions, 1);
  } finally {
    await server.stop();
  }
});
