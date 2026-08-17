const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");
const { upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");
const { SqliteCloudPaperAccountRepository, PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperCanonicalRiskGateway } = require("../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

const principal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });

function createHarness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-cloud-paper-e2e-"));
  const databasePath = path.join(directory, "paper.sqlite");
  let now = 100_000;
  let openP0 = false;
  const db = new SqliteDatabase(databasePath);
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => now });
  const repository = new SqliteCloudPaperAccountRepository(db, { now: () => now });
  const loop = new PaperTradingExecutionLoop({ initialCapital: 100_000, repository, readP0State: () => ({ openP0 }) });
  const risk = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: "a".repeat(40) });
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0 }) });

  const hydrate = (changeRate, price) => {
    const observation = upbitTickerToIntelligenceObservation({
      type: "ticker",
      code: "KRW-BTC",
      trade_price: price,
      trade_timestamp: now,
      signed_change_rate: changeRate,
      acc_trade_price_24h: 1_000_000_000
    }, { now });
    assert.ok(observation);
    assert.equal(observation.rawChangeRate, changeRate);
    hydrator.hydrate(provider, [observation]);
    const dashboard = provider.read(principal);
    assert.ok(dashboard);
    return dashboard;
  };

  const tick = (dashboard, price, overrides = {}) => Object.freeze({
    now,
    market: "KRW-BTC",
    price,
    observedAt: now,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: dashboard.decisions,
    investmentPercent: 100,
    ...overrides
  });

  return {
    directory,
    databasePath,
    db,
    provider,
    repository,
    loop,
    risk,
    boundary,
    hydrate,
    tick,
    now: () => now,
    advance: (milliseconds) => { now += milliseconds; },
    setP0: (value) => { openP0 = value; }
  };
}

function closeHarness(harness) {
  try { harness.repository.close(); } catch {}
  try { harness.db.close(); } catch {}
  fs.rmSync(harness.directory, { recursive: true, force: true });
}

function projectOrders(state) {
  return state.orders.map((order) => ({
    id: order.id,
    market: order.market,
    side: order.side,
    quantity: order.quantity,
    price: order.price,
    fee: order.fee,
    filledAt: new Date(order.filledAt).toISOString(),
    status: "FILLED",
    fills: state.fills.filter((fill) => fill.orderId === order.id).map((fill) => ({
      id: fill.id,
      quantity: fill.quantity,
      price: fill.price,
      filledAt: new Date(fill.filledAt).toISOString()
    }))
  }));
}

function projectPortfolio(state) {
  const position = state.positions.find((item) => item.quantity > 0) ?? state.positions[0];
  const assetValue = state.positions.reduce((sum, item) => sum + item.quantity * item.markPrice, 0);
  const markPrice = position?.markPrice ?? 0;
  return {
    observedAt: new Date(state.updatedAt).toISOString(),
    mode: "PAPER",
    account: {
      available: true,
      cash: state.cash,
      equity: state.equity,
      unrealizedPnl: state.unrealizedPnL,
      assetValue,
      realizedPnl: state.realizedPnL,
      markPrice,
      position: position == null
        ? { market: "", quantity: 0, averagePrice: 0, realizedPnl: state.realizedPnL, unrealizedPnl: 0 }
        : { market: position.market, quantity: position.quantity, averagePrice: position.averageEntryPrice, realizedPnl: position.realizedPnL, unrealizedPnl: position.unrealizedPnL }
    },
    openOrderCount: 0
  };
}

test("production PAPER path executes BUY then SELL through real CIO, canonical risk, accounting, SQLite reopen, and mobile operations authority", () => {
  const harness = createHarness();
  try {
    const buyDashboard = harness.hydrate(0.03, 50_000);
    assert.equal(buyDashboard.overallHealth, "HEALTHY");
    assert.equal(buyDashboard.decisions[0].action, "BUY");
    assert.equal(buyDashboard.decisions[0].score, 1);

    const buy = harness.boundary.processTick(harness.tick(buyDashboard, 50_000, { investmentPercent: 25 }));
    assert.equal(buy.status, "FILLED");
    assert.equal(buy.orders.length, 1);
    assert.equal(buy.fills.length, 1);
    assert.ok(buy.orders[0].fee > 0);
    assert.ok(buy.orders[0].quantity * buy.orders[0].price + buy.orders[0].fee <= 25_000 + 1e-8);

    const afterBuy = harness.loop.snapshot();
    assert.equal(afterBuy.positions[0].market, "KRW-BTC");
    assert.ok(afterBuy.positions[0].quantity > 0);
    assert.ok(afterBuy.cash < afterBuy.initialCapital);
    assert.equal(afterBuy.orders.length, 1);
    assert.equal(afterBuy.fills.length, 1);
    assert.equal(afterBuy.processedIdempotencyKeys.length, 1);
    assert.ok(Math.abs(afterBuy.equity - (afterBuy.cash + afterBuy.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0))) < 1e-8);

    harness.provider.set(harness.loop.applyToDashboard(buyDashboard, harness.now()));
    harness.advance(2_000);
    const sellDashboard = harness.hydrate(-0.03, 55_000);
    assert.equal(sellDashboard.decisions[0].action, "SELL");
    assert.equal(sellDashboard.decisions[0].score, -1);

    const sell = harness.boundary.processTick(harness.tick(sellDashboard, 55_000, { investmentPercent: 0 }));
    assert.equal(sell.status, "FILLED");
    assert.equal(sell.orders.length, 1);
    assert.equal(sell.orders[0].side, "SELL");
    assert.ok(sell.orders[0].fee > 0);

    const finalState = harness.loop.snapshot();
    assert.equal(finalState.positions[0].quantity, 0);
    assert.ok(finalState.realizedPnL > 0);
    assert.equal(finalState.unrealizedPnL, 0);
    assert.equal(finalState.orders.length, 2);
    assert.equal(finalState.fills.length, 2);
    assert.equal(finalState.processedIdempotencyKeys.length, 2);
    assert.ok(Math.abs(finalState.equity - finalState.cash) < 1e-8);
    for (const order of finalState.orders) {
      const fills = finalState.fills.filter((fill) => fill.orderId === order.id);
      assert.equal(fills.length, 1);
      assert.equal(fills[0].market, order.market);
      assert.equal(fills[0].side, order.side);
      assert.equal(fills[0].quantity, order.quantity);
      assert.equal(fills[0].price, order.price);
      assert.equal(fills[0].fee, order.fee);
    }

    const apiDashboard = buildMobileDashboardResponse(harness.loop.applyToDashboard(sellDashboard, harness.now()));
    const operations = buildPersonalPaperOperationsSnapshot({
      dashboard: apiDashboard,
      research: null,
      operations: {
        runtimeState: "READY",
        schedulerRunning: true,
        schedulerMode: "ACTIVE",
        pipelineStage: "PAPER_EXECUTION",
        transport: "ONLINE",
        killSwitchActive: false,
        accountHalted: false,
        pendingWrites: 0,
        lastEventAt: harness.now(),
        updatedAt: harness.now()
      },
      portfolio: projectPortfolio(finalState),
      orders: projectOrders(finalState),
      markets: [{ market: "KRW-BTC", price: 55_000, changeRate: -0.03, volume: 1, observedAt: new Date(harness.now()).toISOString(), source: "UPBIT_PUBLIC_TICKER" }]
    }, harness.now());
    assert.equal(operations.health, "HEALTHY");
    assert.equal(operations.readyForPaperOperations, true);
    assert.equal(operations.orders.length, 2);
    assert.equal(operations.liveAuthority, "NONE");
    assert.equal(operations.productionMutationAllowed, false);

    const expected = structuredClone(finalState);
    harness.repository.close();
    harness.db.close();
    const reopenedDb = new SqliteDatabase(harness.databasePath);
    const reopenedRepository = new SqliteCloudPaperAccountRepository(reopenedDb, { now: () => harness.now() });
    const restored = new PaperTradingExecutionLoop({ initialCapital: 100_000, repository: reopenedRepository, readP0State: () => ({ openP0: false }) });
    assert.deepEqual(restored.snapshot(), expected);
    reopenedRepository.close();
    reopenedDb.close();
  } finally {
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("production PAPER path preserves WAIT semantics and enforces zero-percent BUY allocation without mutation", () => {
  const harness = createHarness();
  try {
    const quietDashboard = harness.hydrate(0.001, 50_000);
    assert.equal(quietDashboard.decisions[0].action, "WAIT");
    assert.equal(quietDashboard.decisions[0].score, 0);
    const beforeWait = structuredClone(harness.loop.snapshot());
    const wait = harness.boundary.processTick(harness.tick(quietDashboard, 50_000));
    assert.equal(wait.status, "WAIT");
    assert.deepEqual(harness.loop.snapshot(), beforeWait);

    harness.advance(2_000);
    const buyDashboard = harness.hydrate(0.03, 50_000);
    assert.equal(buyDashboard.decisions[0].action, "BUY");
    const beforeZero = structuredClone(harness.loop.snapshot());
    const zero = harness.boundary.processTick(harness.tick(buyDashboard, 50_000, { investmentPercent: 0 }));
    assert.notEqual(zero.status, "FILLED");
    assert.deepEqual(harness.loop.snapshot(), beforeZero);
  } finally {
    closeHarness(harness);
  }
});

test("production PAPER path fails closed for stale data, kill switch, P0 uncertainty, unsafe strategy, non-PAPER input, and duplicate replay", () => {
  const harness = createHarness();
  try {
    const dashboard = harness.hydrate(0.03, 50_000);
    const baseline = structuredClone(harness.loop.snapshot());

    const stale = harness.boundary.processTick(harness.tick(dashboard, 50_000, { observedAt: harness.now() - 30_001 }));
    assert.notEqual(stale.status, "FILLED");
    assert.deepEqual(harness.loop.snapshot(), baseline);

    const killed = harness.boundary.processTick(harness.tick(dashboard, 50_000, { killSwitchActive: true }));
    assert.notEqual(killed.status, "FILLED");
    assert.deepEqual(harness.loop.snapshot(), baseline);

    harness.setP0(true);
    const p0 = harness.boundary.processTick(harness.tick(dashboard, 50_000));
    assert.equal(p0.status, "BLOCKED");
    assert.equal(p0.reason, "OPEN_P0_ALERT");
    assert.deepEqual(harness.loop.snapshot(), baseline);
    harness.setP0(false);

    const uncertainBoundary = new CloudPaperExecutionBoundary({
      loop: harness.loop,
      riskGate: harness.risk,
      readP0State: () => { throw new Error("P0 unavailable"); }
    });
    const uncertain = uncertainBoundary.processTick(harness.tick(dashboard, 50_000));
    assert.equal(uncertain.status, "BLOCKED");
    assert.equal(uncertain.reason, "P0_STATE_UNVERIFIABLE");
    assert.deepEqual(harness.loop.snapshot(), baseline);

    const unsafeDecision = Object.freeze({ ...dashboard.decisions[0], leverage: 2 });
    const unsafe = harness.boundary.processTick(harness.tick(dashboard, 50_000, { decisions: Object.freeze([unsafeDecision]) }));
    assert.equal(unsafe.status, "BLOCKED");
    assert.equal(unsafe.reason, "STRATEGY_APPROVAL_REJECTED");
    assert.deepEqual(harness.loop.snapshot(), baseline);

    const nonPaper = harness.boundary.processTick(harness.tick(dashboard, 50_000, { mode: "LIVE" }));
    assert.equal(nonPaper.status, "BLOCKED");
    assert.deepEqual(harness.loop.snapshot(), baseline);

    // Production runtime always re-projects the executed PAPER account after a tick.
    // Preserve that boundary here so a blocked planned allocation cannot masquerade as
    // an executed position when the next CIO decision is hydrated.
    harness.provider.set(harness.loop.applyToDashboard(dashboard, harness.now()));
    const projectedTruth = harness.provider.read(principal);
    assert.ok(projectedTruth);
    assert.equal(projectedTruth.portfolio.allocations.length, 0);

    harness.advance(2_000);
    const freshDashboard = harness.hydrate(0.03, 50_000);
    assert.equal(freshDashboard.decisions[0].action, "BUY");
    const first = harness.boundary.processTick(harness.tick(freshDashboard, 50_000));
    assert.equal(first.status, "FILLED");
    const afterFirst = structuredClone(harness.loop.snapshot());
    const replay = harness.boundary.processTick(harness.tick(freshDashboard, 50_000));
    assert.notEqual(replay.status, "FILLED");
    assert.deepEqual(harness.loop.snapshot(), afterFirst);
    assert.equal(harness.loop.snapshot().orders.length, 1);
    assert.equal(harness.loop.snapshot().fills.length, 1);
  } finally {
    closeHarness(harness);
  }
});
