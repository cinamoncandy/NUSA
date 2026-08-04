const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { replayPaperLedger } = require("../dist/apps/desktop/src/paperSafetyGates.js");

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

test("restore rejects persisted projection fields that diverge from the ledger", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  broker.execute("BUY", 1, 100, new Date(1_000));
  const state = broker.exportState();
  assert.throws(() => new PaperBroker(1_000, "KRW-BTC", 0, {}, {
    ...state,
    cash: 1,
    position: { ...state.position, quantity: 99, averagePrice: 1, realizedPnl: 999 }
  }), /PROJECTION_MISMATCH/);
});
