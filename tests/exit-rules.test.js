const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldStopLoss, shouldTimeStop } = require("../dist/apps/desktop/src/strategy/exitRules.js");

test("shouldStopLoss triggers once price falls to or below the stop threshold", () => {
  assert.equal(shouldStopLoss({ entryPrice: 100, currentPrice: 95, stopLossFraction: 0.05 }), true); // exactly at the stop (95)
  assert.equal(shouldStopLoss({ entryPrice: 100, currentPrice: 94, stopLossFraction: 0.05 }), true); // below the stop
});

test("shouldStopLoss does not trigger above the threshold, including on a price increase", () => {
  assert.equal(shouldStopLoss({ entryPrice: 100, currentPrice: 96, stopLossFraction: 0.05 }), false); // stop at 95, 96 is above
  assert.equal(shouldStopLoss({ entryPrice: 100, currentPrice: 110, stopLossFraction: 0.05 }), false);
});

test("shouldStopLoss validates inputs", () => {
  assert.throws(() => shouldStopLoss({ entryPrice: 0, currentPrice: 100, stopLossFraction: 0.05 }), /entryPrice/);
  assert.throws(() => shouldStopLoss({ entryPrice: 100, currentPrice: -1, stopLossFraction: 0.05 }), /currentPrice/);
  assert.throws(() => shouldStopLoss({ entryPrice: 100, currentPrice: 100, stopLossFraction: 0 }), /stopLossFraction/);
  assert.throws(() => shouldStopLoss({ entryPrice: 100, currentPrice: 100, stopLossFraction: 1 }), /stopLossFraction/);
});

test("shouldTimeStop triggers once the holding duration meets or exceeds the limit", () => {
  assert.equal(shouldTimeStop({ openedAt: 1_000, now: 1_000 + 3_600_000, maxHoldingMs: 3_600_000 }), true);
  assert.equal(shouldTimeStop({ openedAt: 1_000, now: 1_000 + 3_600_001, maxHoldingMs: 3_600_000 }), true);
  assert.equal(shouldTimeStop({ openedAt: 1_000, now: 1_000 + 3_599_999, maxHoldingMs: 3_600_000 }), false);
});

test("shouldTimeStop validates inputs, including now before openedAt", () => {
  assert.throws(() => shouldTimeStop({ openedAt: 2_000, now: 1_000, maxHoldingMs: 1_000 }), /now cannot be before openedAt/);
  assert.throws(() => shouldTimeStop({ openedAt: -1, now: 1_000, maxHoldingMs: 1_000 }), /openedAt/);
  assert.throws(() => shouldTimeStop({ openedAt: 1_000, now: 2_000, maxHoldingMs: 0 }), /maxHoldingMs/);
});
