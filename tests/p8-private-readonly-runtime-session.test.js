const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteP0AlertRepository } = require("../dist/apps/cloud/src/p0AlertRepository.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { buildPortfolioViewModel } = require("../dist/apps/mobile/src/portfolioViewModel.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

function testEnv(token, port, dbPath = ":memory:") {
  return {
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: dbPath,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000"
  };
}

function seedP0(dbPath, corrupt = false) {
  const db = new SqliteDatabase(dbPath);
  try {
    const p0 = new SqliteP0AlertRepository(db);
    p0.append({
      eventId: "p8-open",
      incidentId: "p8-runtime-incident",
      type: "OPENED",
      occurredAt: 100,
      reason: "P8 read-only projection must fail closed"
    });
    if (corrupt) db.connection.prepare("UPDATE cloud_p0_alert_events SET hash = ? WHERE sequence = 1").run("f".repeat(64));
  } finally { db.close(); }
}

async function loadOperations(handle, token) {
  const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, { headers: { authorization: `Bearer ${token}` } });
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

test("dashboard bearer credential is never sent over insecure remote HTTP", async () => {
  let requestCount = 0;
  const credentialProvider = async () => "read-only-dashboard-token-123456";
  const request = async () => {
    requestCount += 1;
    return { ok: false, status: 503 };
  };
  const insecure = await loadPersonalPaperOperations({ baseUrl: "http://192.168.1.50:41731", credentialProvider, request });
  assert.equal(insecure.status, "NOT_CONFIGURED");
  assert.equal(requestCount, 0);
  const secure = await loadPersonalPaperOperations({ baseUrl: "https://nusa.invalid", credentialProvider, request });
  assert.equal(secure.status, "UNAVAILABLE");
  assert.equal(requestCount, 1);
  const loopback = await loadPersonalPaperOperations({ baseUrl: "http://127.0.0.1:41731", credentialProvider, request });
  assert.equal(loopback.status, "UNAVAILABLE");
  assert.equal(requestCount, 2);
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
    assert.equal(body.portfolio.account.assetValue, 0);
    assert.equal(body.portfolio.account.realizedPnl, 0);
    assert.deepEqual(body.orders, []);
    assert.deepEqual(body.markets, []);
  } finally { await handle.stop(); }
});

test("multi-position PAPER portfolio projects aggregate totals without corrupting representative position", async () => {
  const token = ["p8", "multi-position", "read-only", "dashboard", "fixture"].join("-");
  const restoredState = Object.freeze({
    version: 1,
    initialCapital: 1000000,
    cash: 560000,
    equity: 1000000,
    realizedPnL: 3000,
    unrealizedPnL: 40000,
    positions: Object.freeze([
      Object.freeze({ market: "KRW-BTC", quantity: 1, averageEntryPrice: 200000, realizedPnL: 1000, unrealizedPnL: 20000, markPrice: 220000 }),
      Object.freeze({ market: "KRW-ETH", quantity: 2, averageEntryPrice: 100000, realizedPnL: 2000, unrealizedPnL: 20000, markPrice: 110000 })
    ]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt: 1000
  });
  const paperLoop = new PaperTradingExecutionLoop({ initialCapital: 1000000, restoredState });
  const handle = startCloudRuntime(testEnv(token, 41944), undefined, undefined, undefined, undefined, undefined, paperLoop);
  try {
    const body = await loadOperations(handle, token);
    assert.equal(body.portfolio.account.assetValue, 440000);
    assert.equal(body.portfolio.account.realizedPnl, 3000);
    assert.equal(body.portfolio.account.unrealizedPnl, 40000);
    assert.equal(body.portfolio.account.position.market, "KRW-BTC");
    assert.equal(body.portfolio.account.position.realizedPnl, 1000);
    assert.equal(body.portfolio.account.position.unrealizedPnl, 20000);
    const view = buildPortfolioViewModel(body.portfolio);
    assert.equal(view.assetValue, 440000);
    assert.equal(view.realizedPnl, 3000);
    assert.equal(view.unrealizedPnl, 40000);
    assert.equal(view.totalPnl, 43000);
    assert.equal(view.position.market, "KRW-BTC");
    assert.equal(view.position.realizedPnl, 1000);
    assert.equal(view.position.unrealizedPnl, 20000);
  } finally { await handle.stop(); }
});

test("open durable P0 projects Personal PAPER Operations as HALTED", async () => {
  const p0OpenCredential = "p8-open-p0-read-only-token-123456";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-p8-open-p0-"));
  const dbPath = path.join(dir, "state.sqlite");
  seedP0(dbPath);
  const handle = startCloudRuntime(testEnv(p0OpenCredential, 41942, dbPath));
  try {
    const body = await loadOperations(handle, p0OpenCredential);
    assert.equal(body.operations.runtimeState, "HALTED");
    assert.equal(body.operations.accountHalted, true);
    assert.equal(body.health, "FAIL_CLOSED");
    assert.equal(body.readyForPaperOperations, false);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
  } finally {
    await handle.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unverifiable durable P0 projects Personal PAPER Operations as HALTED", async () => {
  const p0CorruptCredential = "p8-corrupt-p0-read-only-token-123456";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-p8-corrupt-p0-"));
  const dbPath = path.join(dir, "state.sqlite");
  seedP0(dbPath, true);
  const handle = startCloudRuntime(testEnv(p0CorruptCredential, 41943, dbPath));
  try {
    const body = await loadOperations(handle, p0CorruptCredential);
    assert.equal(body.operations.runtimeState, "HALTED");
    assert.equal(body.operations.accountHalted, true);
    assert.equal(body.health, "FAIL_CLOSED");
    assert.equal(body.readyForPaperOperations, false);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
  } finally {
    await handle.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  assert.match(runtime, /volume:\s*ticker\.acc_trade_volume\s*\?\?\s*null/);
  assert.doesNotMatch(runtime, /volume:\s*ticker\.acc_trade_price_24h/);
  assert.match(runtime, /SqliteP0AlertRepository/);
  assert.match(runtime, /readP0State:/);
  assert.match(runtime, /effectiveP0Repository\.readState\(\)\.openP0/);
});
