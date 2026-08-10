const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

// Pins down the same drift fix as tests/paper-broker-scaled-accounting.test.js, for the
// cloud execution loop's own accumulating state (executeOrder/markToMarket), which is a
// separate implementation from apps/desktop's PaperBroker and had its own round8 that never
// actually removed accumulated float error (see the commit message for the before/after).

const market = "KRW-BTC";

function tick(overrides = {}) {
  return {
    now: 1_000,
    market,
    observedAt: 1_000,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    ...overrides
  };
}

function buyDecision(decidedAt) {
  return { symbol: market, action: "BUY", confidence: 1, risk: "LOW", allocation: 1, leverage: 1, score: 0.8, reasons: ["test"], decidedAt };
}

test("average entry price never drifts off a constant fill price across many buys", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000_000_000, feeRate: 0 });
  const price = 91327000.37; // not a clean binary fraction, deliberately
  for (let step = 0; step < 500; step += 1) {
    const now = 1_000 + step;
    const result = loop.processTick(tick({ now, observedAt: now, price, quantity: 0.00000137, decisions: [buyDecision(now)] }));
    assert.equal(result.status, "FILLED");
  }
  const position = loop.snapshot().positions.find((item) => item.market === market);
  assert.equal(position.averageEntryPrice, price);
});

test("cash reconciles exactly against a hand-computed expectation after many round-trip fills", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 100_000_000, feeRate: 0.0007 });
  const startPrice = 91_327_000;
  const quantity = 0.00137291;
  let expectedCash = 100_000_000;
  for (let step = 0; step < 200; step += 1) {
    const buyPrice = startPrice + step;
    const sellPrice = startPrice + step + 1;
    const buyNow = 1_000 + step * 2;
    const sellNow = buyNow + 1;

    const buyResult = loop.processTick(tick({ now: buyNow, observedAt: buyNow, price: buyPrice, quantity, decisions: [buyDecision(buyNow)] }));
    assert.equal(buyResult.status, "FILLED");
    const buyNotional = quantity * buyPrice;
    expectedCash -= buyNotional + buyNotional * 0.0007;

    const sellResult = loop.processTick(tick({
      now: sellNow,
      observedAt: sellNow,
      price: sellPrice,
      quantity,
      decisions: [{ symbol: market, action: "SELL", confidence: 1, risk: "LOW", allocation: 0, leverage: 1, score: -0.8, reasons: ["exit"], decidedAt: sellNow }]
    }));
    assert.equal(sellResult.status, "FILLED");
    const sellNotional = quantity * sellPrice;
    expectedCash += sellNotional - sellNotional * 0.0007;
  }
  const snapshot = loop.snapshot();
  assert.equal(snapshot.positions.find((item) => item.market === market).quantity, 0);
  assert.ok(Math.abs(snapshot.cash - expectedCash) < 0.001, `cash ${snapshot.cash} vs expected ${expectedCash}`);
});
