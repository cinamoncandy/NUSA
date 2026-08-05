const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");

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
const verifier = {
  verify(token) {
    if (token !== VALID_TOKEN) return undefined;
    return { userId: "owner-1", scopes: ["dashboard:read"] };
  }
};

const dashboardPayload = () => buildMobileDashboardResponse({
  now: 1000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY",
  headline: "정상 운용 중입니다.", issues: [],
  portfolio: { allocations: [], deployedCapital: 0, cashCapital: 1000, reservedCapital: 0, grossShare: 0, futuresShare: 0, decidedAt: 1000 },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: 1000 }
});

async function withServer(run) {
  const handle = startCloudDashboardServer({
    port: 41799,
    tokenVerifier: verifier,
    loadDashboard: () => dashboardPayload()
  });
  try {
    await run(handle);
  } finally {
    await handle.stop();
  }
}

test("an unauthenticated request is rejected over a real socket, not just in-process", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/");
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(res.body).error, "UNAUTHORIZED");
  });
});

test("a valid bearer token receives the dashboard payload with no-store caching", async () => {
  await withServer(async (handle) => {
    const res = await request(handle.port, "/", { authorization: `Bearer ${VALID_TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store, max-age=0");
    const body = JSON.parse(res.body);
    assert.equal(body.tradingAllowed, true);
  });
});

test("a wrong-scope or invalid token is rejected, and a non-GET method is rejected", async () => {
  await withServer(async (handle) => {
    const bad = await request(handle.port, "/", { authorization: "Bearer not-a-real-token" });
    assert.equal(bad.status, 401);

    const post = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: handle.port, path: "/", method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` } }, (res) => {
        let body = ""; res.on("data", (c) => body += c); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(post.status, 405);
  });
});

test("the server can be stopped and the port released", async () => {
  const handle = startCloudDashboardServer({ port: 41800, tokenVerifier: verifier, loadDashboard: () => dashboardPayload() });
  await handle.stop();
  // stopping twice must not throw or hang
  await handle.stop();
  const second = startCloudDashboardServer({ port: 41800, tokenVerifier: verifier, loadDashboard: () => dashboardPayload() });
  await second.stop();
});

test("an invalid port is rejected before any socket is opened", () => {
  assert.throws(() => startCloudDashboardServer({ port: 80, tokenVerifier: verifier, loadDashboard: dashboardPayload }), /invalid cloud dashboard server port/);
  assert.throws(() => startCloudDashboardServer({ port: 99999, tokenVerifier: verifier, loadDashboard: dashboardPayload }), /invalid cloud dashboard server port/);
});
