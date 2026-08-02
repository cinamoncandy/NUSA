const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTradingCommandCenter } = require("../dist/apps/mobile/src/tradingCommandCenter.js");

const input = (overrides = {}) => ({
  generatedAt: 100, mode: "PAPER",
  account: { totalEquity: 1000, availableCapital: 800, reservedCapital: 200, todaysPnl: 10 },
  market: { regime: "SIDEWAYS", health: "HEALTHY", watchlist: [{ market: "KRW-BTC", price: 100, changeRate: 0.01 }] },
  positions: [{ market: "KRW-BTC", pnl: 5, size: 100, risk: "HEALTHY", durationMs: 60_000 }],
  strategy: { state: "RUNNING", lastSignal: "BUY", confidence: 0.8 },
  risk: { dailyLoss: 0, exposure: 0.1, riskBudget: 0.2, health: "HEALTHY", warnings: [], emergencyActive: false },
  systems: { TRADING_ENGINE: "HEALTHY", MARKET_DATA: "HEALTHY", WEBSOCKET: "HEALTHY", LEDGER: "HEALTHY", RECOVERY: "HEALTHY", AI: "HEALTHY" },
  activity: [{ type: "EXECUTION", message: "Paper fill", occurredAt: 99 }], ...overrides
});

test("command center prioritizes account, market, strategy, risk, and system health", () => {
  const result = buildTradingCommandCenter(input());
  assert.equal(result.health, "HEALTHY");
  assert.equal(result.account.totalEquity, 1000);
  assert.equal(result.market.regime, "SIDEWAYS");
  assert.equal(result.strategy.lastSignal, "BUY");
  assert.equal(result.quickActions.BUY, true);
  assert.equal(Object.isFrozen(result), true);
});

test("unknown or emergency state disables trading actions and raises required attention", () => {
  const result = buildTradingCommandCenter(input({ risk: { ...input().risk, emergencyActive: true }, systems: { ...input().systems, LEDGER: "UNKNOWN" } }));
  assert.equal(result.health, "ACTION_REQUIRED");
  assert.equal(result.quickActions.BUY, false);
  assert.equal(result.quickActions.EMERGENCY_STOP, false);
});

test("empty states are explicit and capital must reconcile", () => {
  const result = buildTradingCommandCenter(input({ account: { totalEquity: 0, availableCapital: 0, reservedCapital: 0, todaysPnl: 0 }, positions: [], strategy: { state: "STOPPED", lastSignal: null, confidence: null } }));
  assert.ok(result.emptyStates.PORTFOLIO);
  assert.ok(result.emptyStates.POSITIONS);
  assert.ok(result.emptyStates.STRATEGY);
  assert.throws(() => buildTradingCommandCenter(input({ account: { totalEquity: 100, availableCapital: 90, reservedCapital: 20, todaysPnl: 0 } })), /reconcile/);
});
