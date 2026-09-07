const assert = require("node:assert/strict");
const test = require("node:test");
const { selectActionablePaperMarket } = require("../scripts/select-actual-paper-e2e-market.js");

const now = 2_000_000;
const row = (market, change, turnover = 2_000_000_000, tradeTimestamp = now) => ({ market, trade_price: 1000, signed_change_rate: change, acc_trade_price_24h: turnover, acc_trade_volume_24h: 123, trade_timestamp: tradeTimestamp, timestamp: now });

test("selects a naturally actionable public market using canonical CIO thresholds", () => {
  const selected = selectActionablePaperMarket([
    row("KRW-BTC", 0.005),
    row("KRW-AAA", 0.012),
    row("KRW-BBB", 0.02),
  ], now);
  assert.equal(selected.status, "NATURALLY_ACTIONABLE_MARKET");
  assert.equal(selected.market, "KRW-BBB");
  assert.equal(selected.actionableCount, 2);
  assert.ok(selected.score >= 0.35);
  assert.ok(selected.confidence >= 0.55);
});

test("does not manufacture an actionable signal when public markets do not qualify", () => {
  const selected = selectActionablePaperMarket([
    row("KRW-BTC", 0.005),
    row("KRW-AAA", -0.02),
  ], now);
  assert.deepEqual(selected, { market: "KRW-BTC", status: "NO_NATURALLY_ACTIONABLE_MARKET", actionableCount: 0 });
});

test("low-turnover positive moves remain non-actionable because canonical confidence is preserved", () => {
  const selected = selectActionablePaperMarket([row("KRW-AAA", 0.03, 100_000_000)], now);
  assert.equal(selected.status, "NO_NATURALLY_ACTIONABLE_MARKET");
});


test("prefers the most liquid already-actionable market for realtime evidence liveness", () => {
  const selected = selectActionablePaperMarket([
    row("KRW-FAST", 0.012, 20_000_000_000),
    row("KRW-SLOW", 0.03, 2_000_000_000),
  ], now);
  assert.equal(selected.status, "NATURALLY_ACTIONABLE_MARKET");
  assert.equal(selected.market, "KRW-FAST");
  assert.equal(selected.actionableCount, 2);
});

test("uses the actual last-trade timestamp instead of a fresh REST response timestamp", () => {
  const selected = selectActionablePaperMarket([
    row("KRW-STALE", 0.03, 20_000_000_000, now - 30_001),
  ], now);
  assert.deepEqual(selected, { market: "KRW-BTC", status: "NO_NATURALLY_ACTIONABLE_MARKET", actionableCount: 0 });
});
