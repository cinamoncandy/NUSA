const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");

const runtimeSource = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8");
const workflowSource = fs.readFileSync(".github/workflows/wo-0059-actual-paper-runtime.yml", "utf8");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const dashboard = {
  apiVersion: "1",
  generatedAt: 1000,
  mode: "PAPER",
  killSwitchActive: false,
  overallHealth: "HEALTHY",
  tradingAllowed: true,
  headline: "PAPER runtime is running",
  issues: [],
  portfolio: { allocations: [], deployedCapital: 0, reservedCapital: 0, cashCapital: 100000, grossShare: 0, futuresShare: 0, decidedAt: 1000 },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: 1000 }
};

test("PAPER operations exposes an observable automatic runtime heartbeat", () => {
  const snapshot = buildPersonalPaperOperationsSnapshot({
    dashboard,
    research: null,
    operations: {
      runtimeState: "RUNNING",
      schedulerRunning: true,
      schedulerMode: "ACTIVE",
      pipelineStage: "PAPER_EXECUTION_LOOP",
      transport: "ONLINE",
      killSwitchActive: false,
      accountHalted: false,
      pendingWrites: 0,
      updatedAt: 1000,
      heartbeat: {
        startedAt: 500,
        lastHeartbeatAt: 1000,
        lastMarketEventAt: 900,
        lastPaperDecisionAt: 900,
        lastPaperOrderAt: null,
        lastPaperFillAt: null,
        eventCount: 1,
        decisionCount: 1,
        paperOrderCount: 0,
        paperFillCount: 0,
        lastError: null
      }
    },
    portfolio: null,
    orders: [],
    markets: [{ market: "KRW-BTC", price: 100, changeRate: 0, volume: 1, observedAt: new Date(900).toISOString(), source: "UPBIT_PUBLIC_TICKER" }]
  }, 1000);
  assert.equal(snapshot.operations.schedulerRunning, true);
  assert.equal(snapshot.operations.schedulerMode, "ACTIVE");
  assert.equal(snapshot.operations.runtimeState, "RUNNING");
  assert.equal(snapshot.readyForPaperOperations, true);
  assert.equal(snapshot.operations.heartbeat.eventCount, 1);
});

test("Actual PAPER runtime evidence is not restricted to a dedicated branch", () => {
  assert.match(workflowSource, /pull_request:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflowSource, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.doesNotMatch(workflowSource, /if:\s*github\.event_name.*wo-0059/);
  assert.match(runtimeSource, /marketDataClient\.subscribe\(config\.upbitMarkets\); marketDataClient\.start\(\)/);
  assert.match(runtimeSource, /const heartbeatTimer = setInterval\(\(\) =>/);
  assert.match(runtimeSource, /schedulerRunning: autoRunning, schedulerMode: autoRunning \? "ACTIVE"/);
});

test("Cloud runtime automatically processes a trusted public ticker without a manual order command", async () => {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(value));
    });
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-auto-runtime-"));
  const databasePath = path.join(directory, "state.sqlite");
  const dashboardCredential = "paper-auto-runtime-test-token-32-bytes-min";
  let stopped = false;
  const marketFactory = (_markets, onTicker, onConnectionState) => ({
    subscribe() {},
    start() {
      onConnectionState("CONNECTED");
      setTimeout(() => onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: Date.now(), signed_change_rate: 0.03, acc_trade_price_24h: 1_000_000_000 }), 10).unref?.();
    },
    stop() { stopped = true; }
  });
  const handle = startCloudRuntime({
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_TOKEN: dashboardCredential,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
    NUSA_CLOUD_STATE_DB_PATH: databasePath,
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10",
    NUSA_SOURCE_COMMIT: "test-source"
  }, undefined, undefined, marketFactory);
  try {
    const deadline = Date.now() + 5_000;
    let snapshot;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/paper-operations`, { headers: { authorization: `Bearer ${dashboardCredential}` } });
        if (response.ok) {
          const candidate = await response.json();
          if (candidate.operations?.heartbeat?.eventCount > 0) { snapshot = candidate; break; }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(snapshot, "automatic public ticker was not observed");
    assert.equal(snapshot.operations.schedulerRunning, true);
    assert.equal(snapshot.operations.schedulerMode, "ACTIVE");
    assert.equal(snapshot.operations.runtimeState, "RUNNING");
    assert.equal(snapshot.markets[0].source, "UPBIT_PUBLIC_TICKER");
    assert.ok(snapshot.operations.heartbeat.decisionCount > 0);
    assert.equal(snapshot.liveAuthority, "NONE");
    assert.equal(snapshot.productionMutationAllowed, false);
    const database = new DatabaseSync(databasePath);
    const persisted = database.prepare("SELECT COUNT(*) AS count FROM paper_learning_observability_events").get();
    database.close();
    assert.ok(Number(persisted.count) > 0, "runtime must persist the read-only learning timeline in the configured Cloud database");
  } finally {
    await handle.stop();
    assert.equal(stopped, true);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
