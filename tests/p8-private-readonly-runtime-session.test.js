const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

function testEnv(token, port) {
  return {
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: ":memory:",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000"
  };
}

test("memory-only dashboard credential session never persists or infers local auth", async () => {
  const session = new InMemoryDashboardCredentialSession();
  assert.equal(await session.credentialProvider(), null);
  assert.throws(() => session.connect("short"), /invalid/);
  session.connect("  read-only-dashboard-token-123456  ");
  assert.equal(await session.credentialProvider(), "read-only-dashboard-token-123456");
  assert.equal(session.isConfigured(), true);
  assert.equal(Object.prototype.hasOwnProperty.call(session, "storage"), false);
  session.clear();
  assert.equal(await session.credentialProvider(), null);
});

test("cloud runtime exposes one authenticated read-only snapshot with real PAPER account projection", async () => {
  const token = ["p8", "read-only", "dashboard", "token", "123456"].join("-");
  const handle = startCloudRuntime(testEnv(token, 41941));
  try {
    const unauthenticated = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`);
    assert.equal(unauthenticated.status, 401);
    const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.portfolio.mode, "PAPER");
    assert.equal(body.portfolio.account.cash, 1000000);
    assert.equal(body.portfolio.account.equity, 1000000);
    assert.deepEqual(body.orders, []);
    assert.deepEqual(body.markets, []);
  } finally { await handle.stop(); }
});

test("mobile source consumes only the single authenticated operations snapshot and exposes no mutation path", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const session = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "dashboardCredentialSession.ts"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "personalPaperOperationsClient.ts"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "runtime.ts"), "utf8");
  assert.match(app, /InMemoryDashboardCredentialSession/);
  assert.match(app, /secureTextEntry/);
  assert.match(app, /snapshot\?\.portfolio/);
  assert.match(app, /snapshot\?\.orders/);
  assert.match(app, /snapshot\.markets/);
  assert.match(client, /\/api\/paper-operations/);
  assert.doesNotMatch(client, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(session, /AsyncStorage|Keychain|SecureStore|console\.|process\.env/);
  assert.doesNotMatch(app, /placeOrder|cancelOrder|withdraw|\/api\/(?:account|markets|orders|trade)/);
  assert.match(runtime, /portfolio:\s*buildReadOnlyPortfolio/);
  assert.match(runtime, /orders:\s*buildReadOnlyOrders/);
  assert.match(runtime, /markets:\s*\[\.\.\.latestTickers\.values\(\)\]/);
  assert.match(runtime, /latestTickers\.clear\(\)/);
});
