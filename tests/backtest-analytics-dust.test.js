const test = require("node:test");
const assert = require("node:assert/strict");
const { matchTrades } = require("../dist/apps/desktop/src/backtestAnalytics.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");

const order = (side, quantity, price, minute, fee = 0) => ({
  id: `${minute}-${side}`,
  market: "KRW-BTC",
  side,
  quantity,
  price,
  fee,
  filledAt: new Date(Date.UTC(2026, 6, 28, 0, minute)).toISOString()
});

test("a fully closed position is FLAT even when the quantities do not sum exactly", () => {
  // 0.1 + 0.2 is 0.30000000000000004 in binary floating point, so selling 0.3 leaves a
  // residue of about 2.8e-17. Nothing exotic is required to hit this -- these are the most
  // ordinary quantities a user could enter, which is why the existing tests, built on
  // exactly-representable values like 0.5, never saw it.
  const result = matchTrades([
    order("BUY", 0.1, 100, 1),
    order("BUY", 0.2, 100, 2),
    order("SELL", 0.3, 110, 3)
  ]);
  assert.equal(result.openPosition.status, "FLAT", `residue: ${result.openPosition.quantity}`);
  assert.equal(result.openPosition.quantity, 0);
});

test("the residue does not survive across differently-priced lots either", () => {
  const result = matchTrades([
    order("BUY", 0.1, 100, 1),
    order("BUY", 0.2, 200, 2),
    order("SELL", 0.3, 150, 3)
  ]);
  assert.equal(result.openPosition.status, "FLAT", `residue: ${result.openPosition.quantity}`);
});

test("a long chain of ordinary quantities still closes flat", () => {
  const orders = [];
  for (let index = 0; index < 10; index += 1) orders.push(order("BUY", 0.1, 100 + index, index + 1));
  orders.push(order("SELL", 1.0, 120, 20));
  const result = matchTrades(orders);
  assert.equal(result.openPosition.status, "FLAT", `residue: ${result.openPosition.quantity}`);
  assert.equal(result.trades.length, 10, "each lot should produce one matched trade");
});

test("a genuinely open position is still reported, with its real quantity", () => {
  // The fix must not swallow a position that actually exists. 0.05 is thousands of times
  // larger than any floating-point residue and must survive untouched.
  const result = matchTrades([
    order("BUY", 0.1, 100, 1),
    order("BUY", 0.2, 200, 2),
    order("SELL", 0.25, 150, 3)
  ]);
  assert.equal(result.openPosition.status, "OPEN_POSITION");
  assert.ok(Math.abs(result.openPosition.quantity - 0.05) < 1e-12, `quantity: ${result.openPosition.quantity}`);
  assert.equal(result.openPosition.averageEntryPrice, 200, "the remainder came from the 200 lot");
});

test("a position smaller than one satoshi is still reported, not rounded away", () => {
  // The tolerance must sit far below anything a real market can trade. BTC's smallest unit
  // is 1e-8; a position at that size is real and must not be treated as arithmetic noise.
  const result = matchTrades([order("BUY", 1e-8, 100, 1)]);
  assert.equal(result.openPosition.status, "OPEN_POSITION");
  assert.equal(result.openPosition.quantity, 1e-8);
});

test("the analytics agree with the broker on whether the position is closed", () => {
  // The broker already normalises dust away; the analytics did not. One codebase reporting
  // two different answers about the same trades is the actual defect.
  const RISK_POLICY = { maxOrderNotional: 2e9, maxPositionQuantity: 1e9, maxRealizedLoss: 1e9, minOrderNotional: 0 };
  const broker = new PaperBroker(1e12, "KRW-BTC", 0, RISK_POLICY, undefined, { slippageBps: 0, spreadBps: 0, maxFillRatio: 1 });
  broker.execute("BUY", 0.1, 100);
  broker.execute("BUY", 0.2, 100);
  broker.execute("SELL", 0.3, 110);
  const brokerQuantity = broker.exportState().position.quantity;

  const analytics = matchTrades(broker.exportState().orders);
  assert.equal(brokerQuantity, 0, "the broker closes flat");
  assert.equal(analytics.openPosition.status, "FLAT", "and so must the analytics");
});

test("a sell larger than everything held is still rejected", () => {
  // Tolerating dust must not tolerate a genuinely unmatched sell.
  assert.throws(
    () => matchTrades([order("BUY", 0.1, 100, 1), order("SELL", 0.5, 110, 2)]),
    /unmatched sell/
  );
});
