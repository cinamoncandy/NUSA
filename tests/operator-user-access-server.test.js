const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");

const fixtureCredential = ["operator", "fixture"].join("-");
const verifier = { verify(value) { return value === fixtureCredential ? { userId: "operator", scopes: ["dashboard:read", "users:manage"] } : undefined; } };

function request(port, method, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/operator/users", method, headers: { authorization: `Bearer ${fixtureCredential}`, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => { let data = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { data += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
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

test("pending users cannot access protected dashboard routes even with a manage scope", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  const pendingVerifier = { verify(value) { return value === "pending-token" ? { userId: "user-1", scopes: ["dashboard:read", "users:manage"] } : undefined; } };
  const port = 42188;
  const handle = startCloudDashboardServer({ port, tokenVerifier: pendingVerifier, userAccessRepository: repository, loadDashboard() { throw new Error("unused"); } });
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/dashboard", method: "GET", headers: { authorization: "Bearer pending-token" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(response, 401);
  } finally { await handle.stop(); }
});

test("active non-owner users cannot access the operator management API", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  repository.changeStatus({ actorUserId: "operator", targetUserId: "user-1", action: "APPROVE", now: 3 });
  const userVerifier = { verify(value) { return value === "user-token" ? { userId: "user-1", scopes: ["dashboard:read", "users:manage"] } : undefined; } };
  const port = 42189;
  const handle = startCloudDashboardServer({ port, tokenVerifier: userVerifier, userAccessRepository: repository, loadDashboard() { throw new Error("unused"); } });
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/operator/users", method: "GET", headers: { authorization: "Bearer user-token" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(response, 403);
  } finally { await handle.stop(); }
});
