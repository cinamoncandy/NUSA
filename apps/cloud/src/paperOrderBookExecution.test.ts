import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperOrderBookExecutionReceipt, validatePaperOrderBookExecutionReceipt, PaperOrderBookExecutionError } from "./paperOrderBookExecution";
import { buildPaperObservedExecutionQuote } from "./paperRuntimeExecutionCostEvidence";

function quote() {
  return buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 1_000,
    totalAskSize: 20,
    totalBidSize: 20,
    units: [
      { askPrice: 110, bidPrice: 100, askSize: 4, bidSize: 4 },
      { askPrice: 120, bidPrice: 90, askSize: 10, bidSize: 3 },
      { askPrice: 130, bidPrice: 80, askSize: 6, bidSize: 13 },
    ],
  });
}

test("BUY depth execution preserves PortfolioPlan gross-notional budget and seals consumed levels", () => {
  const observed = quote();
  const receipt = buildPaperOrderBookExecutionReceipt({
    quote: observed,
    side: "BUY",
    requestedQuantity: 10,
    maximumNotional: 1_000,
    filledAt: 1_100,
  });
  assert.equal(receipt.budgetLimited, true);
  assert.ok(receipt.filledQuantity < 10);
  assert.equal(receipt.consumedLevels[0]?.price, 110);
  assert.equal(receipt.consumedLevels[0]?.quantity, 4);
  assert.equal(receipt.consumedLevels[1]?.price, 120);
  assert.ok(receipt.grossNotional <= 1_000);
  assert.equal(receipt.vwapPrice, Number((receipt.grossNotional / receipt.filledQuantity).toFixed(8)));
  assert.match(receipt.depthFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.fingerprintSha256, /^[a-f0-9]{64}$/);

  assert.deepEqual(validatePaperOrderBookExecutionReceipt(receipt, {
    market: "KRW-BTC",
    side: "BUY",
    filledQuantity: receipt.filledQuantity,
    fillPrice: receipt.vwapPrice,
    quoteReceipt: observed.receipt,
    intentQuantity: 10,
    allocationCapital: 1_000,
  }), receipt);
});

test("SELL depth execution fails closed instead of inventing liquidity or silently partial-filling", () => {
  assert.throws(
    () => buildPaperOrderBookExecutionReceipt({ quote: quote(), side: "SELL", requestedQuantity: 25, filledAt: 1_100 }),
    (error: unknown) => error instanceof PaperOrderBookExecutionError && error.code === "PAPER_ORDERBOOK_LIQUIDITY_INSUFFICIENT"
  );
});

test("depth execution receipt rejects tampered consumed-level evidence", () => {
  const observed = quote();
  const receipt = buildPaperOrderBookExecutionReceipt({
    quote: observed,
    side: "BUY",
    requestedQuantity: 5,
    maximumNotional: 1_000,
    filledAt: 1_100,
  });
  const tampered = Object.freeze({
    ...receipt,
    consumedLevels: Object.freeze(receipt.consumedLevels.map((level, index) => index === 0 ? Object.freeze({ ...level, price: level.price + 1 }) : level)),
  });
  assert.throws(
    () => validatePaperOrderBookExecutionReceipt(tampered, {
      market: "KRW-BTC",
      side: "BUY",
      filledQuantity: receipt.filledQuantity,
      fillPrice: receipt.vwapPrice,
      quoteReceipt: observed.receipt,
      intentQuantity: 5,
      allocationCapital: 1_000,
    }),
    PaperOrderBookExecutionError
  );
});

test("depth provenance rejects mutation after the public orderbook quote was constructed", () => {
  const observed = quote();
  const mutated = Object.freeze({
    ...observed,
    depth: Object.freeze(observed.depth!.map((level, index) => index === 1 ? Object.freeze({ ...level, askSize: level.askSize + 1 }) : level)),
  });
  assert.throws(
    () => buildPaperOrderBookExecutionReceipt({ quote: mutated, side: "BUY", requestedQuantity: 1, maximumNotional: 1_000, filledAt: 1_100 }),
    /fingerprint/
  );
});
