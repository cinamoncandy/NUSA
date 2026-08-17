const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
const { upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");
const { SqliteCloudPaperAccountRepository, PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperCanonicalRiskGateway } = require("../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

test("production PAPER path connects realistic Upbit evidence through canonical risk to SQLite fill", () => {
  const now = 10_000;
  const db = new SqliteDatabase(":memory:");
  const provider = new InMemoryCloudDashboardStateProvider();
  const hydrator = new CloudRuntimeDashboardHydrator({ now: () => now });
  const observation = upbitTickerToIntelligenceObservation({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: now, signed_change_rate: 0.03, acc_trade_price_24h: 1_000_000_000 }, { now });
  hydrator.hydrate(provider, [observation]);
  const dashboard = provider.read({ userId: "operator", scopes: ["dashboard:read"] });
  assert.equal(dashboard.overallHealth, "HEALTHY");
  assert.equal(dashboard.decisions[0].action, "BUY");

  const repository = new SqliteCloudPaperAccountRepository(db, { now: () => now });
  const loop = new PaperTradingExecutionLoop({ initialCapital: 100_000, feeRate: 0, repository, readP0State: () => ({ openP0: false }) });
  const risk = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: "a".repeat(40) });
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }) });
  const tick = { now, market: "KRW-BTC", price: 50_000, observedAt: now, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", decisions: dashboard.decisions, investmentPercent: 100 };
  const result = boundary.processTick(tick);
  assert.equal(result.status, "FILLED");
  assert.equal(result.orders.length, 1);
  assert.equal(result.fills.length, 1);
  assert.equal(loop.snapshot().positions[0].market, "KRW-BTC");
  assert.equal(loop.snapshot().orders.length, 1);
  const restored = new PaperTradingExecutionLoop({ initialCapital: 100_000, feeRate: 0, repository, readP0State: () => ({ openP0: false }) });
  assert.deepEqual(restored.snapshot(), loop.snapshot());
  assert.equal(restored.snapshot().liveAuthority, undefined);
  repository.close();
  db.close();
});
