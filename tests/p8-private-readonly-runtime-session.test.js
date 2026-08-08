const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteCloudDashboardSnapshotRepository } = require("../dist/apps/cloud/src/cloudDashboardSnapshotRepository.js");
const { SqliteP0AlertRepository } = require("../dist/apps/cloud/src/p0AlertRepository.js");

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

async function loadOperations(handle, token) {
  const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  return response.json();
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
    const body = await loadOperations(handle, token);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.portfolio.mode, "PAPER");
    assert.equal(body.portfolio.account.cash, 1000000);
    assert.equal(body.portfolio.account.equity, 1000000);
    assert.deepEqual(body.orders, []);
    assert.deepEqual(body.markets, []);
  } finally { await handle.stop(); }
});

test("open durable P0 incident projects Personal PAPER Operations as HALTED", async () => {
  const token = ["p8", "p0-open", "dashboard", "token", "123456"].join("-");
  const db = new SqliteDatabase(":memory:");
  const snapshots = new SqliteCloudDashboardSnapshotRepository(db);
  const p0 = new SqliteP0AlertRepository(db);
  p0.append({ eventId: "p8-open", incidentId: "p8-runtime", type: "OPENED", occurredAt: 100, reason: "runtime safety incident" });
  const handle = startCloudRuntime(testEnv(token, 41942), undefined, undefined, undefined, snapshots);
  try {
    const body = await loadOperations(handle, token);
    assert.equal(body.operations.runtimeState, "HALTED");
    assert.equal(body.operations.accountHalted, true);
    assert.equal(body.health, "FAIL_CLOSED");
    assert.equal(body.readyForPaperOperations, false);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
  } finally { await handle.stop(); }
});

test("corrupted durable P0 evidence also projects Personal PAPER Operations as HALTED", async () => {
  const token = ["p8", "p0-corrupt", "dashboard", "token", "123456"].join("-");
  const db = new SqliteDatabase(":memory:");
  const snapshots = new SqliteCloudDashboardSnapshotRepository(db);
  const p0 = new SqliteP0AlertRepository(db);
  p0.append({ eventId: "p8-corrupt", incidentId: "p8-runtime", type: "OPENED", occurredAt: 100, reason: "runtime safety incident" });
  db.connection.prepare("UPDATE cloud_p0_alert_events SET hash = ? WHERE sequence = 1").run("f".repeat(64));
  const handle = startCloudRuntime(testEnv(token, 41943), undefined, undefined, undefined, snapshots);
  try {
    const body = await loadOperations(handle, token);
    assert.equal(body.operations.runtimeState, "HALTED");
    assert.equal(body.operations.accountHalted, true);
    assert.equal(body.health, "FAIL_CLOSED");
    assert.equal(body.readyForPaperOperations, false);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
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
  assert.match(runtime, /p0Halted\s*=\s*effectiveP0Repository\?\.readState\(\)\.openP0/);
  assert.match(runtime, /dashboard\.mode === "FAULTED" \|\| dashboard\.killSwitchActive \|\| p0Halted/);
});