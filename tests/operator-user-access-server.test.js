const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");

const fixtureCredential = ["operator", "fixture"].join("-");
const verifier = {
  ownerPrincipal: { userId: "operator", email: "owner@nusa.local", scopes: ["dashboard:read", "paper:trade", "users:manage"] },
  verify(value) { return value === fixtureCredential ? this.ownerPrincipal : undefined; }
};

function request(port, path, method, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => { let data = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { data += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : undefined })); });
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
    const before = await request(port, "/api/operator/users", "GET", fixtureCredential);
    assert.equal(before.status, 200);
    assert.equal(before.body.users.find((user) => user.id === "user-1").status, "PENDING");
    const approved = await request(port, "/api/operator/users", "POST", fixtureCredential, { targetUserId: "user-1", action: "APPROVE" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.user.status, "ACTIVE");
  } finally { await handle.stop(); }
});

test("pending users cannot access protected dashboard routes even with a manage scope", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  const pendingVerifier = { verify(value) { return value === "pending-token" ? { userId: "user-1", email: "user@example.com", scopes: ["dashboard:read", "users:manage"] } : undefined; } };
  const port = 42188;
  const handle = startCloudDashboardServer({ port, tokenVerifier: pendingVerifier, userAccessRepository: repository, loadDashboard() { return {}; } });
  try {
    const response = await request(port, "/api/dashboard", "GET", "pending-token");
    assert.equal(response.status, 401);
  } finally { await handle.stop(); }
});

test("active non-owner users cannot access the operator management API", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  repository.changeStatus({ actorUserId: "operator", targetUserId: "user-1", action: "APPROVE", now: 3 });
  const userVerifier = { verify(value) { return value === "user-token" ? { userId: "user-1", email: "user@example.com", scopes: ["dashboard:read", "users:manage"] } : undefined; } };
  const port = 42189;
  const handle = startCloudDashboardServer({ port, tokenVerifier: userVerifier, userAccessRepository: repository, loadDashboard() { throw new Error("unused"); } });
  try {
    const response = await request(port, "/api/operator/users", "GET", "user-token");
    assert.equal(response.status, 403);
  } finally { await handle.stop(); }
});

test("first-seen authenticated user is PENDING, approval enables access, suspension invalidates the same bearer", async () => {
  const ownerToken = "owner-identity-token";
  const userToken = "user-identity-token";
  const ownerPrincipal = { userId: "owner-real", email: "owner@example.com", scopes: ["dashboard:read", "paper:trade", "users:manage"] };
  const identityVerifier = {
    ownerPrincipal,
    verify(value) {
      if (value === ownerToken) return ownerPrincipal;
      if (value === userToken) return { userId: "user-real", email: "user@example.com", displayName: "Real User", scopes: ["dashboard:read", "paper:trade"] };
      return undefined;
    }
  };
  const repository = new InMemoryNusaUserAccessRepository();
  const port = 42190;
  const handle = startCloudDashboardServer({
    port,
    tokenVerifier: identityVerifier,
    userAccessRepository: repository,
    loadDashboard(principal) { return { principal: principal.userId }; }
  });
  try {
    const pending = await request(port, "/api/dashboard", "GET", userToken);
    assert.equal(pending.status, 401);
    assert.equal(repository.get("user-real").status, "PENDING");
    assert.equal(repository.get("user-real").email, "user@example.com");

    const approve = await request(port, "/api/operator/users", "POST", ownerToken, { targetUserId: "user-real", action: "APPROVE" });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.user.status, "ACTIVE");

    const active = await request(port, "/api/dashboard", "GET", userToken);
    assert.equal(active.status, 200);

    const suspend = await request(port, "/api/operator/users", "POST", ownerToken, { targetUserId: "user-real", action: "SUSPEND" });
    assert.equal(suspend.status, 200);
    assert.equal(suspend.body.user.status, "SUSPENDED");

    const blocked = await request(port, "/api/dashboard", "GET", userToken);
    assert.equal(blocked.status, 401);
    const actions = repository.listAudit().filter((entry) => entry.targetUserId === "user-real").map((entry) => entry.action);
    assert.deepEqual(actions, ["SUSPEND", "APPROVE"]);
  } finally { await handle.stop(); }
});

test("approved access is bound to the stored principal email identity", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  repository.changeStatus({ actorUserId: "operator", targetUserId: "user-1", action: "APPROVE", now: 3 });
  const mismatchedVerifier = { verify(value) { return value === "mismatch-token" ? { userId: "user-1", email: "other@example.com", scopes: ["dashboard:read"] } : undefined; } };
  const port = 42191;
  const handle = startCloudDashboardServer({ port, tokenVerifier: mismatchedVerifier, userAccessRepository: repository, loadDashboard() { return { ok: true }; } });
  try {
    const response = await request(port, "/api/dashboard", "GET", "mismatch-token");
    assert.equal(response.status, 401);
    assert.equal(repository.get("user-1").email, "user@example.com");
  } finally { await handle.stop(); }
});

test("approved access fails closed when the principal omits identity email", async () => {
  const repository = new InMemoryNusaUserAccessRepository();
  repository.ensureOwner({ id: "operator", email: "owner@nusa.local" }, 1);
  repository.registerUser({ id: "user-1", email: "user@example.com" }, 2);
  repository.changeStatus({ actorUserId: "operator", targetUserId: "user-1", action: "APPROVE", now: 3 });
  const incompleteVerifier = { verify(value) { return value === "incomplete-token" ? { userId: "user-1", scopes: ["dashboard:read"] } : undefined; } };
  const port = 42192;
  const handle = startCloudDashboardServer({ port, tokenVerifier: incompleteVerifier, userAccessRepository: repository, loadDashboard() { return { ok: true }; } });
  try {
    const response = await request(port, "/api/dashboard", "GET", "incomplete-token");
    assert.equal(response.status, 401);
  } finally { await handle.stop(); }
});
