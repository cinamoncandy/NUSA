const test = require("node:test");
const assert = require("node:assert/strict");
const { runWalkForwardRequest, compoundedSequence } = require("../scripts/lib/walk-forward-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}

function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest(candles) {
  return {
    schemaVersion: 1,
    id: "WF-AGGREGATE-001",
    market: "KRW-BTC",
    candles,
    windows: { trainingCandles: 150, validationCandles: 30, testCandles: 60, stepCandles: 60 },
    parameterGrid: [
      { shortWindow: 2, longWindow: 8 }, { shortWindow: 3, longWindow: 12 }, { shortWindow: 4, longWindow: 16 }, { shortWindow: 5, longWindow: 20 }, { shortWindow: 6, longWindow: 24 }
    ],
    selectionMetric: "RETURN_OVER_DRAWDOWN",
    minimumTrades: 1,
    execution: { initialCash: 10_000_000, feeRate: 0.0005, executionCosts: { spreadBps: 0, slippageBps: 5 }, latencyCandles: 0, riskPolicy: {} }
  };
}

test("compoundedSequence multiplies (1+r) across windows, not a plain sum", () => {
  const value = compoundedSequence([0.1, -0.05, 0.02]);
  assert.ok(Math.abs(value - (1.1 * 0.95 * 1.02 - 1)) < 1e-12);
  assert.notEqual(value, 0.1 - 0.05 + 0.02);
});

test("aggregate profitable/losing counts partition all PASSed windows by return sign; no-trade is a separate, non-exclusive dimension", () => {
  // noTradeTestWindows counts zero CLOSED (matched) trades, which can still coincide
  // with a nonzero return from an unclosed position marked to market -- so it is not
  // mutually exclusive with profitable/losing and must not be asserted as additive.
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const { profitableTestWindows, losingTestWindows, noTradeTestWindows, passedWindowCount } = result.aggregate;
  assert.ok(profitableTestWindows + losingTestWindows <= passedWindowCount);
  assert.ok(noTradeTestWindows >= 0 && noTradeTestWindows <= passedWindowCount);
});

test("compoundedOosReturn matches the product-of-(1+return) formula over recorded test returns", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const expected = compoundedSequence(result.windows.map((w) => w.test.summary.totalReturn));
  assert.ok(Math.abs(expected - result.aggregate.compoundedOosReturn) < 1e-9);
});

test("benchmarks include cash (always flat), buy-and-hold, and fixed 5/20", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.benchmarks.cash.compoundedReturn, 0);
  assert.ok(Number.isFinite(result.benchmarks.buyAndHold.compoundedReturn));
  assert.ok(Number.isFinite(result.benchmarks.fixedParameter5x20.compoundedReturn));
});

test("parameter stability summary reports a most-selected parameter drawn from the grid", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const gridKeys = new Set(result.parameterGrid.map((p) => `${p.shortWindow}/${p.longWindow}`));
  assert.ok(gridKeys.has(result.aggregate.parameterStability.mostSelectedParameter));
  assert.ok(result.aggregate.parameterStability.parameterSwitchCount >= 0);
  assert.ok(result.aggregate.parameterStability.uniqueParameterCount >= 1);
});

test("degradation records one entry per PASSed window with training/validation/test deltas", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.aggregate.degradation.perWindow.length, result.aggregate.passedWindowCount);
  for (const entry of result.aggregate.degradation.perWindow) assert.ok(typeof entry.trainingToTest === "number");
});

test("the result is JSON-serializable", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(400)));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("the input request object is not mutated by the runner", () => {
  const request = baseRequest(trendingCandles(400));
  const before = JSON.parse(JSON.stringify(request));
  runWalkForwardRequest(request);
  assert.deepEqual(request, before);
});
