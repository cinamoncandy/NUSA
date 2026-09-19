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
