const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const dashboardInput = (now = Date.now()) => ({
  now,
  mode: "PAPER",
  killSwitchActive: false,
  overallHealth: "HEALTHY",
  headline: "Paper dashboard ready",
  issues: [],
  portfolio: {
    allocations: [],
    deployedCapital: 0,
    cashCapital: 1000,
    reservedCapital: 0,
    grossShare: 0,
    futuresShare: 0,
    decidedAt: now
  },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: now }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("failed to allocate test port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function request(port, token = "secret") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path: "/api/dashboard", method: "GET",
      headers: { authorization: `Bearer ${token}` }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.once("error", reject);
    req.end();
  });
}

test("in-memory provider starts empty and only exposes explicitly set state", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  const principal = { userId: "operator", scopes: ["dashboard:read"] };
  assert.equal(provider.read(principal), undefined);
  const input = dashboardInput(100);
  provider.set(input);
  assert.equal(provider.read(principal), input);
  provider.clear();
  assert.equal(provider.read(principal), undefined);
});

test("cloud runtime returns 503 until state is ready and 200 for provider state", async () => {
  const port = await freePort();
  const provider = new InMemoryCloudDashboardStateProvider();
  const handle = startCloudRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: "secret" }, provider);
  try {
    const unavailable = await request(port);
    assert.equal(unavailable.status, 503);
    provider.set(dashboardInput(Date.now()));
    const ready = await request(port);
    assert.equal(ready.status, 200);
    assert.equal(ready.body.mode, "PAPER");
    assert.equal(ready.body.tradingAllowed, true);
    assert.equal(ready.body.deployableCapital, 1000);
  } finally {
    await handle.stop();
  }
});
