"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { UPBIT_KRW_SPOT_SPEC } = require("../dist/apps/cloud/src/researchVenueSpec.js");
const { simulateQuoting } = require("../dist/apps/cloud/src/researchMarketMakingSim.js");

const books = [0, 3000, 6000].map((t) => ({ t, bestBid: 10000, bestAsk: 10020 }));
const trades = [
  { t: 500, price: 9990, volume: 1, side: "ASK" },    // before the placement latency: no fill
  { t: 2000, price: 9990, volume: 1, side: "ASK" },    // strictly below the bid: fills 1
  { t: 2500, price: 10000, volume: 1, side: "ASK" },   // AT the bid: never fills (queue unknown)
  { t: 4000, price: 10030, volume: 0.5, side: "BID" }, // strictly above the ask: fills 0.5
];
const join = (b) => ({ bid: b.bestBid, ask: b.bestAsk, size: 2 });
const base = { spec: UPBIT_KRW_SPOT_SPEC, assumptions: ["SINGLE_LISTED_FEE", "QUANTITY_STEP_IGNORED"], books, trades, quote: join, maxInventory: 5 };

test("blocked while maker/taker fee or quantity step are unknown and no assumption is declared", () => {
  const r = simulateQuoting({ ...base, assumptions: [] });
  assert.equal(r.status, "BLOCKED"); assert.deepEqual(r.unknownFields, ["quantityStep", "makerFeeBp", "takerFeeBp"]);
  assert.deepEqual(simulateQuoting({ ...base, assumptions: ["QUANTITY_STEP_IGNORED"] }).unknownFields, ["makerFeeBp", "takerFeeBp"]);
});

test("conservative fills: only strictly through the quote, after latency; fees and inventory accounted", () => {
  const r = simulateQuoting(base);
  assert.equal(r.status, "SIMULATED"); assert.equal(r.independent, false);
  assert.equal(r.fills, 2); assert.equal(r.quotesPlaced, 5); assert.equal(r.cancels, 2);
  assert.equal(r.endInventory, 0.5);
  assert.ok(Math.abs(r.feePaid - 7.505) < 1e-9);
  assert.ok(Math.abs(r.netPnl - (-0.005)) < 1e-9, "leftover inventory is valued at the last bid net of fee, not at the mid");
  assert.equal(r.filledOrders, 2);
  assert.deepEqual(r.assumptions, ["QUANTITY_STEP_IGNORED", "SINGLE_LISTED_FEE"]);
  assert.equal(simulateQuoting(base).fingerprint, r.fingerprint, "deterministic");
});

test("no short selling, inventory cap, minimum notional and unordered input fail closed", () => {
  assert.equal(simulateQuoting({ ...base, trades: [] }).fills, 0);
  assert.equal(simulateQuoting({ ...base, maxInventory: 0.2 }).endInventory, 0.2, "inventory capped");
  assert.equal(simulateQuoting({ ...base, quote: (b) => ({ bid: b.bestBid, ask: b.bestAsk, size: 0.1 }) }).quotesPlaced, 0, "below 5,000 KRW is never placed");
  const bad = simulateQuoting({ ...base, trades: [trades[3], trades[0]] });
  assert.equal(bad.status, "BLOCKED"); assert.deepEqual(bad.unknownFields, ["INPUT_INVALID_OR_UNORDERED"]);
});

test("a trade exactly AT the quote never fills; partial fills of one order count once; the latency boundary admits t = since + latency", () => {
  const only = (tr) => simulateQuoting({ ...base, trades: tr });
  assert.equal(only([{ t: 2000, price: 10000, volume: 5, side: "ASK" }]).fills, 0);
  const two = only([{ t: 2000, price: 9990, volume: 0.3, side: "ASK" }, { t: 2100, price: 9990, volume: 0.3, side: "ASK" }]);
  assert.equal(two.fills, 2); assert.equal(two.filledOrders, 1); assert.ok(two.fillRate <= 1);
  assert.equal(only([{ t: 999, price: 9990, volume: 1, side: "ASK" }]).fills, 0, "inside the latency");
  assert.equal(only([{ t: 1000, price: 9990, volume: 1, side: "ASK" }]).fills, 1, "at the latency boundary");
});
