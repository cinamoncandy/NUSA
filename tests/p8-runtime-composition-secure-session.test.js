const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SqliteDatabase,
  SqliteResearchSessionRepository,
  SqliteResearchEvaluationLedger,
  SqliteCandidatePromotionRepository
} = require("../dist/packages/storage/src/index.js");
const { SqliteP0AlertRepository } = require("../dist/apps/cloud/src/p0AlertRepository.js");
const { DefaultResearchRuntimeComposition } = require("../dist/apps/cloud/src/researchRuntimeComposition.js");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { startDefaultCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const hash = "a".repeat(64);
const metrics = Object.freeze({
  experimentCount: 0,
  positiveEvaluationCount: 0,
  negativeEvaluationCount: 0,
  cumulativeNetReturn: 0,
  averageNetReturn: 0,
  championBetterCount: 0,
  challengerBetterCount: 0,
  equivalentCount: 0,
  inconclusiveCount: 0,
  costAdjustedPerformance: 0,
  unresolvedFaultCount: 0,
  dataQualityFailureCount: 0,
  tradeCount: 0,
  observationDays: 0,
  executionQuality: 0,
  riskAdjustedPerformance: 0
});

function runningSession() {
  return {
    sessionId: "p8-session",
    state: "RUNNING",
    datasetId: "dataset-1",
    interval: "1m",
    championStrategyId: "champion-1",
    championStrategyVersion: "1.0.0",
    challengerStrategyId: "challenger-1",
    challengerStrategyVersion: "2.0.0",
    experimentCount: 0,
    evaluationIds: [],
    deterministicConfigHash: hash,
    startedAt: 1000,
    updatedAt: 1000,
    maxExperiments: 5,
    metrics
  };
}

async function fetchOperations(handle, token) {
  const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  return response.json();
}

test("memory-only dashboard credential session never persists or infers local auth", async () => {
  const session = new InMemoryDashboardCredentialSession();
  assert.equal(await session.credentialProvider(), null);
  assert.throws(() => session.connect("   "), /invalid/);
  session.connect("short");
  assert.equal(await session.credentialProvider(), "short");
  assert.equal(session.isConfigured(), true);
  assert.equal(Object.prototype.hasOwnProperty.call(session, "storage"), false);
  session.clear();
  assert.equal(await session.credentialProvider(), null);
});

test("mobile read-only client rejects legacy snapshot shapes and insecure remote HTTP", async () => {
  let remoteRequestCalled = false;
  const insecure = await loadPersonalPaperOperations({
    baseUrl: "http://192.0.2.10:41731",
    credentialProvider: async () => "token",
    request: async () => { remoteRequestCalled = true; throw new Error("must not run"); }
  });
  assert.equal(insecure.status, "NOT_CONFIGURED");
  assert.equal(remoteRequestCalled, false);

  const legacy = await loadPersonalPaperOperations({
    baseUrl: "http://127.0.0.1:41731",
    credentialProvider: async () => "token",
    request: async () => ({
      ok: true,
      json: async () => ({ schemaVersion: 1, liveAuthority: "NONE", productionMutationAllowed: false, dashboard: {}, operations: {} })
    })
  });
  assert.equal(legacy.status, "UNAVAILABLE");
});

test("default Research composition replays persistent state, pauses RUNNING work, and never evaluates on ticks", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const sessions = new SqliteResearchSessionRepository(db);
    const ledger = new SqliteResearchEvaluationLedger(db);
    const candidates = new SqliteCandidatePromotionRepository(db);
    sessions.save(runningSession());
    const runtime = new DefaultResearchRuntimeComposition(db, () => 2000);
    const recovered = runtime.recover();
    assert.equal(recovered.status, "READY");
    assert.equal(sessions.load("p8-session").state, "PAUSED");
    const status = runtime.statusProjection();
    assert.equal(status.sessionId, "p8-session");
    assert.equal(status.recoveryStatus, "PAUSED");
    assert.equal(status.champion.authority, "PAPER_ONLY");
    assert.equal(status.challenger.authority, "ZERO_AUTHORITY");
    assert.equal(status.liveAuthority, "NONE");
    assert.equal(status.productionMutationAllowed, false);
    runtime.onMarketData({ market: "KRW-BTC", price: 100, observedAt: 2000, now: 2000 });
    assert.equal(ledger.list().length, 0);
    assert.equal(candidates.listCandidates().length, 0);
    assert.equal(candidates.listAudit().length, 0);
  } finally { db.close(); }
});

test("default cloud runtime exposes one authenticated read-only PAPER projection", async () => {
  const token = "p8-read-only-dashboard-token-123456";
  const handle = startDefaultCloudRuntime({
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: "41939",
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: ":memory:",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000"
  });
  try {
    const unauthenticated = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`);
    assert.equal(unauthenticated.status, 401);
    const body = await fetchOperations(handle, token);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.portfolio.mode, "PAPER");
    assert.equal(body.portfolio.account.cash, 1000000);
    assert.deepEqual(body.orders, []);
    assert.deepEqual(body.markets, []);
  } finally { await handle.stop(); }
});

test("durable P0 open or corrupted evidence projects PAPER Operations as HALTED", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-p8-p0-"));
  const databasePath = path.join(dir, "cloud.sqlite");
  const token = "p8-p0-read-only-dashboard-token-123456";
  const handle = startDefaultCloudRuntime({
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: "41940",
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: databasePath,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000"
  });
  const db = new SqliteDatabase(databasePath);
  try {
    const p0 = new SqliteP0AlertRepository(db);
    p0.append({ eventId: "p8-p0-open", incidentId: "p8-p0", type: "OPENED", occurredAt: 100, reason: "P8 projection regression" });
    const open = await fetchOperations(handle, token);
    assert.equal(open.operations.runtimeState, "HALTED");
    assert.equal(open.operations.accountHalted, true);
    assert.equal(open.health, "FAIL_CLOSED");
    assert.equal(open.readyForPaperOperations, false);

    db.connection.prepare("UPDATE cloud_p0_alert_events SET hash = ? WHERE sequence = 1").run("f".repeat(64));
    const corrupted = await fetchOperations(handle, token);
    assert.equal(corrupted.operations.runtimeState, "HALTED");
    assert.equal(corrupted.operations.accountHalted, true);
    assert.equal(corrupted.health, "FAIL_CLOSED");
    assert.equal(corrupted.readyForPaperOperations, false);
  } finally {
    db.close();
    await handle.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P8 source wiring preserves P0 fill safety and has no implicit Research evaluator or mutation route", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "runtime.ts"), "utf8");
  const research = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "researchRuntimeComposition.ts"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const session = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "dashboardCredentialSession.ts"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "personalPaperOperationsClient.ts"), "utf8");
  assert.match(runtime, /startDefaultCloudRuntime/);
  assert.match(runtime, /createDefaultResearchRuntimeComposition/);
  assert.match(runtime, /SqliteP0AlertRepository/);
  assert.match(runtime, /readP0State/);
  assert.match(runtime, /P0 safety repository unavailable/);
  assert.match(runtime, /p0ProjectionHalted/);
  assert.match(runtime, /latestTickers\.clear\(\)/);
  assert.match(runtime, /portfolio:\s*buildReadOnlyPortfolio/);
  assert.match(runtime, /orders:\s*buildReadOnlyOrders/);
  assert.match(runtime, /markets:\s*\[\.\.\.latestTickers\.values\(\)\]/);
  assert.match(research, /onMarketData\(_tick/);
  assert.doesNotMatch(research, /new ResearchRuntimeCoordinator|evaluate\(|promote\(/);
  assert.match(app, /InMemoryDashboardCredentialSession/);
  assert.match(app, /secureTextEntry/);
  assert.match(app, /snapshot\?\.portfolio/);
  assert.match(app, /snapshot\?\.orders/);
  assert.match(app, /snapshot\.markets/);
  assert.match(client, /Array\.isArray\(snapshot\.orders\)/);
  assert.match(client, /isSecureDashboardEndpoint/);
  assert.doesNotMatch(session, /AsyncStorage|Keychain|SecureStore|console\.|process\.env/);
  assert.doesNotMatch(app, /placeOrder|cancelOrder|withdraw|\/api\/(?:account|markets|orders|trade)/);
});
