const test = require("node:test");
const assert = require("node:assert/strict");
const { projectPaperAccounting, assertPaperAccountingReconciled } = require("../dist/apps/cloud/src/paperAccountingLedger.js");

function fill(id, orderId, side, quantity, price, fee, filledAt) {
  return Object.freeze({ id, orderId, market: "KRW-BTC", side, quantity, price, fee, filledAt });
}

test("PAPER accounting replay is deterministic across input ordering", () => {
  const fills = [
    fill("fill:a", "a", "BUY", 2, 100, 2, 1000),
    fill("fill:b", "b", "SELL", 1, 150, 1, 2000)
  ];
  const first = projectPaperAccounting(1000, fills, { "KRW-BTC": 160 });
  const replay = projectPaperAccounting(1000, [...fills].reverse(), { "KRW-BTC": 160 });
  assert.equal(first.fingerprintSha256, replay.fingerprintSha256);
  assert.deepEqual(first, replay);
  assert.equal(first.cash, 947);
  assert.equal(first.realizedPnL, 48);
  assert.equal(first.positions[0].quantity, 1);
  assert.equal(first.positions[0].averageEntryPrice, 101);
  assert.equal(first.positions[0].unrealizedPnL, 59);
});

test("PAPER accounting rejects duplicate fill identity", () => {
  const duplicate = fill("fill:a", "a", "BUY", 1, 100, 0, 1000);
  assert.throws(() => projectPaperAccounting(1000, [duplicate, duplicate]), /PAPER_LEDGER_DUPLICATE_FILL/);
});

test("PAPER accounting reconciliation fails closed on tampered cash", () => {
  const fills = [fill("fill:a", "a", "BUY", 1, 100, 1, 1000)];
  const projection = projectPaperAccounting(1000, fills, { "KRW-BTC": 100 });
  assert.throws(() => assertPaperAccountingReconciled({
    initialCapital: 1000,
    fills,
    cash: projection.cash + 1,
    realizedPnL: projection.realizedPnL,
    positions: projection.positions
  }), /PAPER_LEDGER_RECONCILIATION_REQUIRED/);
});


test("PAPER accounting supports multiple fills for one order exactly once", () => {
  const fills = [
    fill("fill:partial:1", "order:partial", "BUY", 1, 100, 1, 1000),
    fill("fill:partial:2", "order:partial", "BUY", 2, 110, 2, 1001)
  ];
  const projection = projectPaperAccounting(1000, fills, { "KRW-BTC": 120 });
  assert.equal(projection.journal.length, 2);
  assert.equal(projection.cash, 677);
  assert.equal(projection.positions[0].quantity, 3);
  assert.equal(projection.positions[0].averageEntryPrice, 107.66666666);
  assert.throws(() => projectPaperAccounting(1000, [...fills, fills[1]]), /PAPER_LEDGER_DUPLICATE_FILL/);
});

test("PAPER accounting supports long to flat with fee-aware realized PnL", () => {
  const projection = projectPaperAccounting(1000, [
    fill("fill:buy", "buy", "BUY", 2, 100, 2, 1000),
    fill("fill:sell", "sell", "SELL", 2, 120, 2, 1001)
  ], { "KRW-BTC": 120 });
  assert.equal(projection.cash, 1036);
  assert.equal(projection.realizedPnL, 36);
  assert.equal(projection.positions[0].quantity, 0);
  assert.equal(projection.positions[0].averageEntryPrice, 0);
  assert.equal(projection.positions[0].unrealizedPnL, 0);
});

test("PAPER accounting fails closed on insufficient cash and position", () => {
  assert.throws(() => projectPaperAccounting(100, [
    fill("fill:too-expensive", "buy", "BUY", 2, 100, 1, 1000)
  ]), /PAPER_LEDGER_INSUFFICIENT_CASH/);
  assert.throws(() => projectPaperAccounting(1000, [
    fill("fill:naked-sell", "sell", "SELL", 1, 100, 0, 1000)
  ]), /PAPER_LEDGER_INSUFFICIENT_POSITION/);
});

test("PAPER accounting fingerprint detects event mutation", () => {
  const original = projectPaperAccounting(1000, [
    fill("fill:a", "a", "BUY", 1, 100, 1, 1000)
  ]);
  const mutated = projectPaperAccounting(1000, [
    fill("fill:a", "a", "BUY", 1, 101, 1, 1000)
  ]);
  assert.notEqual(original.fingerprintSha256, mutated.fingerprintSha256);
});
