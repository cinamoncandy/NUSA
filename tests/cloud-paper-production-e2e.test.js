const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");
const { upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");
const { SqliteCloudPaperAccountRepository, PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperCanonicalRiskGateway } = require("../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

function productionBoundary(initialCapital = 100_000) {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudPaperAccountRepository(db, { now: () => 10_000 });
  const loop = new PaperTradingExecutionLoop({ initialCapital, feeRate: 0.001, repository, readP0State: () => ({ openP0: false }) });
  const risk = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital, sourceCommitSha: "a".repeat(40) });
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }) });
  return { db, repository, loop, boundary };
}

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

test("production PAPER boundary fails closed for weak, stale, duplicate, kill-switch, allocation, and non-PAPER inputs", () => {
  const makeTick = ({ decisionOverrides = {}, ...overrides } = {}) => ({ now: 10_000, market: "KRW-BTC", price: 50_000, observedAt: 10_000, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", decisions: [{ symbol: "KRW-BTC", action: "BUY", confidence: 1, risk: "LOW", allocation: 0.1, leverage: 1, score: 1, reasons: ["fixture"], decidedAt: 9_999, ...decisionOverrides }], investmentPercent: 100, ...overrides });

  const weakProvider = new InMemoryCloudDashboardStateProvider();
  new CloudRuntimeDashboardHydrator({ now: () => 10_000 }).hydrate(weakProvider, [upbitTickerToIntelligenceObservation({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: 10_000, signed_change_rate: 0.002, acc_trade_price_24h: 1_000_000_000 }, { now: 10_000 })]);
  assert.equal(weakProvider.read({ userId: "operator", scopes: ["dashboard:read"] }).decisions[0].action, "WAIT");

  const first = productionBoundary();
  const tick = makeTick();
  assert.equal(first.boundary.processTick(tick).status, "FILLED");
  assert.notEqual(first.boundary.processTick(tick).status, "FILLED");
  assert.notEqual(first.boundary.processTick(makeTick({ observedAt: 1_000 })).status, "FILLED");
  assert.equal(first.boundary.processTick(makeTick({ killSwitchActive: true, decisionOverrides: { decidedAt: 9_997 } })).status, "BLOCKED");
  assert.notEqual(first.boundary.processTick(makeTick({ investmentPercent: 0, decisionOverrides: { decidedAt: 9_996 } })).status, "FILLED");
  assert.equal(first.boundary.processTick(makeTick({ mode: "LIVE", decisionOverrides: { decidedAt: 9_995 } })).status, "BLOCKED");
  first.repository.close();
  first.db.close();
});
