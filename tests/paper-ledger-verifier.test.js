const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyPaperLedger } = require("../scripts/lib/paper-ledger-verifier.js");

const order = (id, side, quantity, price, fee, filledAt) => ({ id, side, quantity, price, fee, filledAt });

test("a single BUY moves cash by notional + fee and sets quantity/average price", () => {
  const result = verifyPaperLedger([order("1", "BUY", 10, 100_000, 50, "2026-01-01T00:00:01.000Z")], 10_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.quantity, 10);
  assert.equal(result.averagePrice, 100_000);
  assert.equal(result.totalFees, 50);
  assert.equal(result.cash, 10_000_000 - (10 * 100_000 + 50));
  assert.equal(result.realizedPnl, 0);
});

test("a split BUY produces the correct notional-weighted average entry price", () => {
  const result = verifyPaperLedger([
    order("1", "BUY", 10, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("2", "BUY", 20, 110_000, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.quantity, 30);
  assert.equal(result.averagePrice, ((10 * 100_000) + (20 * 110_000)) / 30);
});

test("a partial SELL realizes PnL on only the sold quantity and leaves the average entry price unchanged", () => {
  const result = verifyPaperLedger([
    order("1", "BUY", 30, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("2", "SELL", 10, 120_000, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.quantity, 20);
  assert.equal(result.averagePrice, 100_000, "average entry price does not change on a partial sell");
  assert.equal(result.realizedPnl, (120_000 - 100_000) * 10);
});

test("a full liquidation zeroes quantity and average price and realizes the entire position's PnL", () => {
  const result = verifyPaperLedger([
    order("1", "BUY", 30, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("2", "SELL", 30, 90_000, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.quantity, 0);
  assert.equal(result.averagePrice, 0);
  assert.equal(result.realizedPnl, (90_000 - 100_000) * 30);
});

test("fees accumulate across both BUY and SELL orders and reduce realized PnL", () => {
  const result = verifyPaperLedger([
    order("1", "BUY", 10, 100_000, 50, "2026-01-01T00:00:01.000Z"),
    order("2", "SELL", 10, 110_000, 55, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalFees, 105);
  assert.equal(result.realizedPnl, (110_000 - 100_000) * 10 - 55);
});

test("orders are replayed in chronological order regardless of input array order", () => {
  const reversed = verifyPaperLedger([
    order("2", "SELL", 10, 120_000, 0, "2026-01-01T00:00:02.000Z"),
    order("1", "BUY", 10, 100_000, 0, "2026-01-01T00:00:01.000Z")
  ], 10_000_000);
  assert.deepEqual(reversed.errors, []);
  assert.equal(reversed.quantity, 0);
  assert.equal(reversed.realizedPnl, (120_000 - 100_000) * 10);
});

test("a SELL quantity exceeding the independently-tracked position is reported as an error", () => {
  const result = verifyPaperLedger([
    order("1", "BUY", 10, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("2", "SELL", 15, 100_000, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.ok(result.errors.some((message) => message.includes("exceeds independently-tracked position")));
});

test("a duplicate order id is reported", () => {
  const result = verifyPaperLedger([
    order("dup", "BUY", 10, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("dup", "SELL", 5, 100_000, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.ok(result.errors.some((message) => message.includes("duplicate order id")));
});

test("non-finite quantity, price, and fee are each rejected", () => {
  for (const bad of [
    order("1", "BUY", NaN, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("2", "BUY", Infinity, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("3", "BUY", 10, NaN, 0, "2026-01-01T00:00:01.000Z"),
    order("4", "BUY", 10, 100_000, NaN, "2026-01-01T00:00:01.000Z"),
    order("5", "BUY", -10, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("6", "BUY", 10, 100_000, -5, "2026-01-01T00:00:01.000Z")
  ]) {
    const result = verifyPaperLedger([bad], 10_000_000);
    assert.ok(result.errors.length > 0, `expected an error for ${JSON.stringify(bad)}`);
  }
});

test("multiple independent errors are all reported in a single pass, not just the first", () => {
  const result = verifyPaperLedger([
    order("dup", "BUY", NaN, 100_000, 0, "2026-01-01T00:00:01.000Z"),
    order("dup", "BUY", 10, -5, 0, "2026-01-01T00:00:02.000Z")
  ], 10_000_000);
  assert.ok(result.errors.length >= 2, `expected multiple errors, got: ${JSON.stringify(result.errors)}`);
});

test("input orders array and its elements are not mutated", () => {
  const orders = Object.freeze([Object.freeze(order("1", "BUY", 10, 100_000, 0, "2026-01-01T00:00:01.000Z"))]);
  assert.doesNotThrow(() => verifyPaperLedger(orders, 10_000_000));
});

test("the result is JSON-serializable", () => {
  const result = verifyPaperLedger([order("1", "BUY", 10, 100_000, 50, "2026-01-01T00:00:01.000Z")], 10_000_000);
  assert.doesNotThrow(() => JSON.stringify(result));
});
