const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeConsecutiveLossCount,
  computeDailyNotional,
  computeOrderRateState,
  tradingDayOf,
} = require("../dist/packages/core/src/paperRiskState.js");

const NOW = Date.parse("2026-09-04T00:00:10.000Z");
const iso = (ms) => new Date(ms).toISOString();
const order = (overrides = {}) => ({
  filledAt: iso(NOW - 500),
  side: "BUY",
  quantity: 1,
  price: 100,
  ...overrides,
});

test("burst counters count recent orders within windows", () => {
  const state = computeOrderRateState(
    [order({ filledAt: iso(NOW - 500) }), order({ filledAt: iso(NOW - 30_000), side: "SELL" }), order({ filledAt: iso(NOW - 120_000) })],
    NOW,
    "BUY"
  );
  assert.equal(state.ordersInLastSecond, 1);
  assert.equal(state.ordersInLastMinute, 2);
  assert.equal(state.sameSideStreak, 1);
});

test("corrupt timestamps fail closed instead of evading burst limits", () => {
  assert.throws(() => computeOrderRateState([order({ filledAt: "not-a-date" })], NOW, "BUY"), /INVALID_ORDER_TIMESTAMP/);
  assert.throws(() => computeOrderRateState([order({ filledAt: "" })], NOW, "BUY"), /INVALID_ORDER_TIMESTAMP/);
  assert.throws(() => computeDailyNotional([order({ filledAt: "garbage" })], "2026-09-04"), /INVALID_ORDER_TIMESTAMP/);
  assert.throws(() => tradingDayOf("garbage"), /INVALID_ORDER_TIMESTAMP/);
});

test("future timestamps count as recent (conservative) rather than ignored", () => {
  const state = computeOrderRateState([order({ filledAt: iso(NOW + 60_000) })], NOW, "BUY");
  assert.equal(state.ordersInLastSecond, 1);
  assert.equal(state.ordersInLastMinute, 1);
});

test("daily notionals bucket by trading day", () => {
  const result = computeDailyNotional(
    [
      order({ filledAt: "2026-09-04T01:00:00.000Z", side: "BUY", quantity: 2, price: 100 }),
      order({ filledAt: "2026-09-04T02:00:00.000Z", side: "SELL", quantity: 1, price: 100 }),
      order({ filledAt: "2026-09-03T23:00:00.000Z", side: "BUY", quantity: 9, price: 100 }),
    ],
    "2026-09-04"
  );
  assert.equal(result.dailyBuyNotional, 200);
  assert.equal(result.dailySellNotional, 100);
});

test("consecutive losses count only the trailing losing run", () => {
  const ledger = [
    { side: "SELL", realizedPnlAfter: 10 },
    { side: "SELL", realizedPnlAfter: 5 },
    { side: "SELL", realizedPnlAfter: 8 },
  ];
  assert.equal(computeConsecutiveLossCount(ledger), 0);
  const losing = [
    { side: "SELL", realizedPnlAfter: 10 },
    { side: "SELL", realizedPnlAfter: 7 },
    { side: "SELL", realizedPnlAfter: 3 },
  ];
  assert.equal(computeConsecutiveLossCount(losing), 2);
});
