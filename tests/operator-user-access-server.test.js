const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");

const token = "operator-token-that-is-more-than-32-bytes";
const verifier = { verify(value) { return value === token ? { userId: "operator", scopes: ["dashboard:read", "users:manage"] } : undefined; } };

function request(port, method, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/operator/users", method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => { let data = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { data += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

test("operator server route lists users and approves a pending user", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  const port = 42187;
  const handle = startCloudDashboardServer({ port, tokenVerifier: verifier, userAccessRepository: repository, loadDashboard() { throw new Error("unused"); } });
  try {
    const before = await request(port, "GET");
    assert.equal(before.status, 200);
    assert.equal(before.body.users.find((user) => user.id === "user-1").status, "PENDING");
    const approved = await request(port, "POST", { targetUserId: "user-1", action: "APPROVE" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.user.status, "ACTIVE");
  } finally { await handle.stop(); }
});
