const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

test("price must align to the configured tick size", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { priceTick: 1000 });
  assert.throws(() => broker.execute("BUY", 0.01, 50_000_500), /price does not align to tick size/);
  const order = broker.execute("BUY", 0.01, 50_000_000);
  assert.equal(order.quotedPrice, 50_000_000);
});

test("tick alignment tolerates floating-point representation error", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { priceTick: 0.1 });
  assert.doesNotThrow(() => broker.execute("BUY", 0.01, 1.1));
});

test("unset priceTick disables the check", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  assert.doesNotThrow(() => broker.execute("BUY", 0.01, 50_000_123));
});

test("priceTick must be positive", () => {
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, { priceTick: 0 }), /priceTick must be positive/);
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, { priceTick: -1 }), /priceTick must be positive/);
});

test("orders below the minimum notional are rejected", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { minOrderNotional: 10_000, quantityStep: 0.0001 });
  assert.throws(() => broker.execute("BUY", 0.0001, 50_000_000), /notional is below minimum order notional/);
  assert.doesNotThrow(() => broker.execute("BUY", 0.001, 50_000_000));
});

test("minimum notional is checked against the conservative fill price, not the quoted price", () => {
  // Quoted notional is 10,000 (below the 10,100 minimum); BUY slippage pushes the fill
  // price up to 51,000,000, so the fill notional (10,200) clears the minimum.
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { minOrderNotional: 10_100 }, undefined, { slippageBps: 200 });
  const order = broker.execute("BUY", 0.0002, 50_000_000);
  assert.equal(order.price, 51_000_000);
});

test("minOrderNotional must be non-negative", () => {
  assert.throws(() => new PaperBroker(1_000_000, "KRW-BTC", 0, { minOrderNotional: -1 }), /minOrderNotional must be non-negative/);
});
