const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");

// `projectFromLedger` replays every fill from scratch, so a naive `number` implementation
// is self-consistent but each averaging/division step still loses precision -- see
// paperBroker.ts's scaled-integer comment. These tests pin down the exact behavior that
// motivated switching that internal bookkeeping to BigInt at a fixed 1e-8 scale.

test("average entry price never drifts off a constant fill price across many buys", () => {
  const broker = new PaperBroker(1_000_000_000_000, "KRW-BTC", 0, { quantityStep: 0.00000001 });
  const price = 91327000.37; // not a clean binary fraction, deliberately
  for (let i = 0; i < 2000; i++) {
    broker.execute("BUY", 0.00000137, price);
  }
  const snapshot = broker.snapshot(price);
  assert.equal(snapshot.position.averagePrice, price);
});

test("quantity and cash reconcile exactly after many round-trip fills", () => {
  const broker = new PaperBroker(100_000_000, "KRW-BTC", 0.0007, { quantityStep: 0.00000001 });
  const startPrice = 91_327_000;
  for (let i = 0; i < 500; i++) {
    broker.execute("BUY", 0.00137291, startPrice + i);
    broker.execute("SELL", 0.00137291, startPrice + i + 1);
  }
  const snapshot = broker.snapshot(startPrice);
  assert.equal(snapshot.position.quantity, 0);
  // Every round trip sells 1 won higher than it bought: 500 round trips of 0.00137291 BTC
  // at a 1-won spread, minus the 0.0007 fee rate charged on both legs' notional.
  const expectedCash = (() => {
    let cash = 100_000_000;
    for (let i = 0; i < 500; i++) {
      const buyPrice = startPrice + i;
      const sellPrice = startPrice + i + 1;
      const buyNotional = 0.00137291 * buyPrice;
      const sellNotional = 0.00137291 * sellPrice;
      cash -= buyNotional + buyNotional * 0.0007;
      cash += sellNotional - sellNotional * 0.0007;
    }
    return cash;
  })();
  assert.ok(Math.abs(snapshot.cash - expectedCash) < 0.001, `cash ${snapshot.cash} vs expected ${expectedCash}`);
});
