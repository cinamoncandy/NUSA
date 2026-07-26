const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWindowPlan } = require("../scripts/lib/walk-forward-runner.js");

function candle(openTime) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: 100, high: 110, low: 90, close: 105, volume: 1 };
}

function candles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000));
}

test("rolling window boundaries match the documented example (train 100, validation 20, test 40, step 40)", () => {
  const plan = buildWindowPlan(candles(500), { trainingCandles: 100, validationCandles: 20, testCandles: 40, stepCandles: 40 });
  assert.equal(plan[0].trainingStartIndex, 0);
  assert.equal(plan[0].trainingEndIndex, 99);
  assert.equal(plan[0].validationStartIndex, 100);
  assert.equal(plan[0].validationEndIndex, 119);
  assert.equal(plan[0].testStartIndex, 120);
  assert.equal(plan[0].testEndIndex, 159);

  assert.equal(plan[1].trainingStartIndex, 40);
  assert.equal(plan[1].trainingEndIndex, 139);
  assert.equal(plan[1].validationStartIndex, 140);
  assert.equal(plan[1].testStartIndex, 160);
  assert.equal(plan[1].testEndIndex, 199);
});

test("without a validation window, test starts immediately after training ends", () => {
  const plan = buildWindowPlan(candles(300), { trainingCandles: 100, validationCandles: 0, testCandles: 40, stepCandles: 40 });
  assert.equal(plan[0].validationStartIndex, null);
  assert.equal(plan[0].validationEndIndex, null);
  assert.equal(plan[0].testStartIndex, 100);
  assert.equal(plan[0].testEndIndex, 139);
});

test("training, validation, and test never overlap for any window", () => {
  const plan = buildWindowPlan(candles(1000), { trainingCandles: 150, validationCandles: 30, testCandles: 60, stepCandles: 60 });
  for (const window of plan) {
    assert.ok(window.trainingEndIndex < window.validationStartIndex);
    assert.ok(window.validationEndIndex < window.testStartIndex);
  }
});

test("an incomplete final test window is excluded, not padded", () => {
  // 100 training + 40 test = 140; with 145 candles the second window's test would run
  // past the end of the dataset and must be dropped rather than shortened.
  const plan = buildWindowPlan(candles(145), { trainingCandles: 100, validationCandles: 0, testCandles: 40, stepCandles: 40 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].testEndIndex, 139);
});

test("boundaries record candle open/close times matching the underlying candle array", () => {
  const data = candles(200);
  const plan = buildWindowPlan(data, { trainingCandles: 100, validationCandles: 20, testCandles: 40, stepCandles: 40 });
  assert.equal(plan[0].trainingStartTime, data[0].openTime);
  assert.equal(plan[0].trainingEndTime, data[99].closeTime);
  assert.equal(plan[0].testStartTime, data[120].openTime);
  assert.equal(plan[0].testEndTime, data[159].closeTime);
});

test("step moves every boundary forward by exactly stepCandles", () => {
  const plan = buildWindowPlan(candles(600), { trainingCandles: 100, validationCandles: 20, testCandles: 40, stepCandles: 40 });
  for (let i = 1; i < plan.length; i += 1) {
    assert.equal(plan[i].trainingStartIndex - plan[i - 1].trainingStartIndex, 40);
    assert.equal(plan[i].testStartIndex - plan[i - 1].testStartIndex, 40);
  }
});

test("insufficient candles for even one complete window yields an empty plan", () => {
  const plan = buildWindowPlan(candles(50), { trainingCandles: 100, validationCandles: 20, testCandles: 40, stepCandles: 40 });
  assert.equal(plan.length, 0);
});
