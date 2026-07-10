const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");

test("paper broker buys, marks to market, and sells", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
  const buy = broker.execute("BUY", 0.01, 50_000_000, new Date("2026-01-01T00:00:00Z"));
  assert.equal(buy.fee, 500);
  let snapshot = broker.snapshot(55_000_000);
  assert.equal(snapshot.cash, 499_500);
  assert.equal(snapshot.position.quantity, 0.01);
  assert.equal(snapshot.unrealizedPnl, 50_000);

  broker.execute("SELL", 0.004, 60_000_000, new Date("2026-01-01T00:01:00Z"));
  snapshot = broker.snapshot(60_000_000);
  assert.equal(snapshot.position.quantity, 0.006);
  assert.equal(snapshot.position.realizedPnl, 39_760);
  assert.equal(snapshot.orders.length, 2);
});

test("paper broker blocks overselling and insufficient cash", () => {
  const broker = new PaperBroker(100_000, "KRW-BTC", 0);
  assert.throws(() => broker.execute("BUY", 1, 100_001), /insufficient paper cash/);
  assert.throws(() => broker.execute("SELL", 0.1, 50_000_000), /insufficient paper position/);
});

test("paper broker validates price and quantity", () => {
  const broker = new PaperBroker();
  assert.throws(() => broker.execute("BUY", 0, 1), /quantity must be positive/);
  assert.throws(() => broker.execute("BUY", 1, Number.NaN), /price must be positive/);
  assert.throws(() => broker.snapshot(0), /markPrice must be positive/);
});
