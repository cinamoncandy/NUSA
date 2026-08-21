const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { replayPaperLedger } = require("../dist/apps/desktop/src/paper/paperSafetyGates.js");

test("ledger replay matches the PaperBroker snapshot after buy and sell", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0.001);
  broker.execute("BUY", 2, 100, new Date(1_000));
  broker.execute("SELL", 1, 120, new Date(2_000));
  const snapshot = broker.snapshot(130);
  const projection = replayPaperLedger(broker.exportState().ledger, 1_000, 130);

  assert.equal(projection.cash, snapshot.cash);
  assert.equal(projection.quantity, snapshot.position.quantity);
  assert.equal(projection.averagePrice, snapshot.position.averagePrice);
  assert.equal(projection.realizedPnl, snapshot.position.realizedPnl);
  assert.equal(projection.unrealizedPnl, snapshot.unrealizedPnl);
  assert.equal(projection.equity, snapshot.equity);
});

test("ledger replay rejects sequence and before-state tampering", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  broker.execute("BUY", 1, 100, new Date(1_000));
  const ledger = broker.exportState().ledger;
  assert.throws(() => replayPaperLedger([{ ...ledger[0], sequence: 2 }], 1_000, 100), /sequence mismatch/);
  assert.throws(() => replayPaperLedger([{ ...ledger[0], cashBefore: 999 }], 1_000, 100), /before-state mismatch/);
});

test("restore derives the portfolio from ledger instead of persisted projection fields", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  broker.execute("BUY", 1, 100, new Date(1_000));
  const state = broker.exportState();
  const restored = new PaperBroker(1_000, "KRW-BTC", 0, {}, {
    ...state,
    cash: 1,
    position: { ...state.position, quantity: 99, averagePrice: 1, realizedPnl: 999 }
  });
  const snapshot = restored.snapshot(100);
  assert.equal(snapshot.cash, 900);
  assert.equal(snapshot.position.quantity, 1);
  assert.equal(snapshot.position.averagePrice, 100);
  assert.equal(snapshot.position.realizedPnl, 0);
});

test("fixed-point ledger replay stays bounded across repeated fractional trades", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.0005);
  let expectedCash = 1_000_000;
  for (let index = 0; index < 2_000; index += 1) {
    const price = 100 + (index % 7) / 10;
    const quantity = 0.001 + (index % 5) / 100_000;
    broker.execute("BUY", quantity, price, new Date(index + 1));
    expectedCash -= quantity * price * 1.0005;
  }

  const snapshot = broker.snapshot(101);
  assert.ok(Math.abs(snapshot.cash - expectedCash) < 1e-5);
});
