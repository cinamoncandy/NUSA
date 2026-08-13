const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { ...headers, connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const VALID_TOKEN = "owner-token";
const ownerPrincipal = Object.freeze({
  userId: "operator",
  email: "operator@nusa.local",
  scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"])
});
const verifier = {
  ownerPrincipal,
  verify(token) {
    if (token !== VALID_TOKEN) return undefined;
    return ownerPrincipal;
  }
};

const dashboardPayload = () => buildMobileDashboardResponse({
  now: 1000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY",
  headline: "정상 운용 중입니다.", issues: [],
  portfolio: { allocations: [], deployedCapital: 0, cashCapital: 1000, reservedCapital: 0, grossShare: 0, futuresShare: 0, decidedAt: 1000 },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: 1000 }
});

const paperOperationsPayload = () => buildPersonalPaperOperationsSnapshot({
  dashboard: dashboardPayload(),
  research: null,
  operations: {
    runtimeState: "READY_OFFLINE",
    schedulerRunning: false,
    schedulerMode: "OFF",
    pipelineStage: "READ_ONLY",
    transport: "OFFLINE",
    killSwitchActive: false,
    accountHalted: false,
    pendingWrites: 0,
    updatedAt: 1000
  }
}, 1000);

async function withServer(run, port = 41799) {
  const handle = startCloudDashboardServer({
    port,
    tokenVerifier: verifier,
    loadDashboard: () => dashboardPayload(),
    loadPaperOperations: () => paperOperationsPayload()
  });
  try {
    await run(handle);
  } finally {
    await handle.stop();
  }
}

test("/health responds without authentication and reports liveness only", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/health");
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(typeof body.observedAt === "string" && body.observedAt.length > 0);
  }, 41801);
});

test("a non-GET request to /health is rejected as method-not-allowed", async () => {
  await withServer(async (handle) => {
    const post = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: handle.port, path: "/health", method: "POST" }, (res) => {
        let body = ""; res.on("data", (c) => body += c); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(post.status, 405);
    assert.equal(JSON.parse(post.body).error, "METHOD_NOT_ALLOWED");
  }, 41802);
});

test("an unauthenticated dashboard request is rejected over a real socket, not just in-process", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/api/dashboard");
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(res.body).error, "UNAUTHORIZED");
  });
});

test("a valid bearer token receives the explicit dashboard payload with no-store caching", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/api/dashboard", { authorization: `Bearer ${VALID_TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store, max-age=0");
    const body = JSON.parse(res.body);
    assert.equal(body.tradingAllowed, true);
  });
});

test("the personal PAPER operations endpoint shares auth and exposes only the read-only authority contract", async () => {
  await withServer(async (handle) => {
    const denied = await request(handle.port, "/api/paper-operations");
    assert.equal(denied.status, 401);

    const res = await request(handle.port, "/api/paper-operations", { authorization: `Bearer ${VALID_TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store, max-age=0");
    const body = JSON.parse(res.body);
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.mode, "PAPER");
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.operations.runtimeState, "READY_OFFLINE");
  }, 41803);
});

test("a wrong-scope or invalid token is rejected, and a non-GET dashboard method is rejected", async () => {
  await withServer(async (handle) => {
    const bad = await request(handle.port, "/api/dashboard", { authorization: "Bearer not-a-real-token" });
    assert.equal(bad.status, 401);

    const post = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: handle.port, path: "/api/dashboard", method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` } }, (res) => {
        let body = ""; res.on("data", (c) => body += c); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(post.status, 405);
  });
});

test("unknown paths stay closed even with a valid dashboard token", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/", { authorization: `Bearer ${VALID_TOKEN}` });
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error, "NOT_FOUND");
  }, 41804);
});

test("the server can be stopped and the port released", async () => {
  const handle = startCloudDashboardServer({ port: 41800, tokenVerifier: verifier, loadDashboard: () => dashboardPayload(), loadPaperOperations: () => paperOperationsPayload() });
  await handle.stop();
  await handle.stop();
  const second = startCloudDashboardServer({ port: 41800, tokenVerifier: verifier, loadDashboard: () => dashboardPayload(), loadPaperOperations: () => paperOperationsPayload() });
  await second.stop();
});

test("an invalid port is rejected before any socket is opened", () => {
  assert.throws(() => startCloudDashboardServer({ port: 80, tokenVerifier: verifier, loadDashboard: dashboardPayload }), /invalid cloud dashboard server port/);
  assert.throws(() => startCloudDashboardServer({ port: 99999, tokenVerifier: verifier, loadDashboard: dashboardPayload }), /invalid cloud dashboard server port/);
});
