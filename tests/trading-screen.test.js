const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTradingScreen } = require("../dist/apps/mobile/src/tradingScreen.js");

const input = (overrides = {}) => ({
  mode: "PAPER", market: "KRW-BTC", regime: "SIDEWAYS", connection: "CONNECTED", strategy: "WAITING", price: 100, change24h: 0.01, volume24h: 1000, spread: 0.1, availableBalance: 1000,
  order: { side: "BUY", type: "MARKET", quantity: 1, price: null, estimatedFee: 0.5, maximumLoss: 10, expectedReward: 20, riskReward: 2 },
  validation: { marketDataFresh: "PASS", riskEngine: "PASS", sufficientBalance: "PASS", positionLimits: "PASS", dailyLossLimit: "PASS", duplicateOrder: "PASS", network: "PASS" },
  supportedOrderTypes: ["MARKET", "LIMIT"], ...overrides
});

test("builds a Paper confirmation with cost and risk before submission", () => {
  const result = buildTradingScreen(input());
  assert.equal(result.canSubmit, true);
  assert.equal(result.confirmation.mode, "PAPER");
  assert.equal(result.confirmation.maximumRisk, 10);
  assert.equal(result.confirmation.riskReward, 2);
  assert.equal(result.emergencyStopVisible, true);
});

test("any failed or unknown pre-trade check disables execution", () => {
  const result = buildTradingScreen(input({ validation: { ...input().validation, marketDataFresh: "UNKNOWN", riskEngine: "FAIL" } }));
  assert.equal(result.canSubmit, false);
  assert.equal(result.disabledReasons.length, 2);
});

test("unsupported order types remain unavailable instead of being emulated", () => {
  const result = buildTradingScreen(input({ order: { ...input().order, type: "STOP" } }));
  assert.equal(result.canSubmit, false);
  assert.match(result.disabledReasons.join(" "), /지원되지 않습니다/);
});

test("unknown post-trade state provides recovery guidance", () => {
  const result = buildTradingScreen(input({ postTrade: { orderStatus: "UNKNOWN", fillStatus: "NONE", ledgerStatus: "UNKNOWN", positionStatus: "UNKNOWN", riskStatus: "UNKNOWN" } }));
  assert.ok(result.recoveryAction);
});
