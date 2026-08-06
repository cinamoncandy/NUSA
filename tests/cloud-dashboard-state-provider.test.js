const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
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

test("cloud runtime hydrates a safe state and returns 200, then serves explicit provider state", async () => {
  const port = await freePort();
  const provider = new InMemoryCloudDashboardStateProvider();
  const handle = startCloudRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: "secret" }, provider);
  try {
    const safe = await request(port);
    assert.equal(safe.status, 200);
    assert.equal(safe.body.killSwitchActive, true);
    assert.equal(safe.body.tradingAllowed, false);
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

test("runtime hydration failure clears state and keeps dashboard at 503", async () => {
  const port = await freePort();
  const provider = new InMemoryCloudDashboardStateProvider(dashboardInput(100));
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: "secret" },
    provider,
    { hydrate() { throw new Error("hydration failed"); } }
  );
  try {
    const response = await request(port);
    assert.equal(response.status, 503);
  } finally {
    await handle.stop();
  }
});

test("runtime hydration creates a safe PAPER state without market data", () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  new CloudRuntimeDashboardHydrator({ now: () => 100 }).hydrate(provider);
  const state = provider.read({ userId: "operator", scopes: ["dashboard:read"] });
  assert.equal(state.mode, "PAPER");
  assert.equal(state.killSwitchActive, true);
  assert.equal(state.overallHealth, "DOWN");
  assert.equal(state.portfolio.allocations.length, 0);
  assert.equal(state.intelligence.signals.length, 1);
  assert.equal(state.decisions[0].action, "WAIT");
});

test("hydration failure clears the provider and preserves fail-closed state", () => {
  const provider = new InMemoryCloudDashboardStateProvider(dashboardInput(100));
  new CloudRuntimeDashboardHydrator({ now: () => -1 }).hydrate(provider);
  assert.equal(provider.read({ userId: "operator", scopes: ["dashboard:read"] }), undefined);
});

test("runtime starts with a hydrated safe state", async () => {
  const port = await freePort();
  const provider = new InMemoryCloudDashboardStateProvider();
  const handle = startCloudRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: "secret" }, provider);
  try {
    const response = await request(port);
    assert.equal(response.status, 200);
    assert.equal(response.body.mode, "PAPER");
    assert.equal(response.body.killSwitchActive, true);
    assert.equal(response.body.tradingAllowed, false);
  } finally {
    await handle.stop();
  }
});

test("ticker hydration exposes a degraded read-only dashboard and stops the socket gracefully", async () => {
  const port = await freePort();
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker;
  let onConnectionState;
  const calls = [];
  const client = {
    subscribe: (markets) => calls.push(["subscribe", [...markets]]),
    start: () => calls.push(["start"]),
    stop: () => calls.push(["stop"])
  };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: "secret", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider,
    new CloudRuntimeDashboardHydrator(),
    (markets, tickerHandler, stateHandler) => {
      onTicker = tickerHandler;
      onConnectionState = stateHandler;
      return client;
    }
  );
  try {
    assert.deepEqual(calls, [["subscribe", ["KRW-BTC"]], ["start"]]);
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, trade_timestamp: Date.now(), signed_change_rate: 0.01, acc_trade_price_24h: 1000 });
    const hydrated = await request(port);
    assert.equal(hydrated.status, 200);
    assert.equal(hydrated.body.overallHealth, "DEGRADED");
    assert.equal(hydrated.body.killSwitchActive, true);
    assert.equal(hydrated.body.tradingAllowed, false);
    assert.equal(hydrated.body.deployableCapital, 0);
    assert.equal(hydrated.body.staleIntelligenceSources?.includes("CHART") ?? false, false);
    onConnectionState("DISCONNECTED");
    const safe = await request(port);
    assert.equal(safe.body.overallHealth, "DOWN");
    assert.equal(safe.body.killSwitchActive, true);
    assert.equal(safe.body.tradingAllowed, false);
  } finally {
    await handle.stop();
  }
  assert.deepEqual(calls.at(-1), ["stop"]);
});
