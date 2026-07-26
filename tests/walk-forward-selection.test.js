const test = require("node:test");
const assert = require("node:assert/strict");
const { runWalkForwardRequest, compareTieBreak } = require("../scripts/lib/walk-forward-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}

function trendingCandles(count, seed = 0) {
  const candles = [];
  for (let i = 0; i < count; i += 1) {
    const price = 100_000 + Math.sin((i + seed) / 6) * 800 + Math.sin((i + seed) / 40) * 4000;
    candles.push(candle(i * 60_000, Math.round(price)));
  }
  return candles;
}

function baseRequest(candles) {
  return {
    schemaVersion: 1,
    id: "WF-SELECTION-001",
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

test("test-window data does not affect which parameter is selected (training+validation determine selection)", () => {
  const candles = trendingCandles(500);
  const requestA = baseRequest(candles);
  // Replace ONLY the test-window candles of the first window with wildly different
  // data; training and validation candles for that window are untouched.
  const requestB = baseRequest(candles.map((c, i) => (i >= 120 && i < 180 ? candle(c.openTime, 999_999 - i) : c)));
  const resultA = runWalkForwardRequest(requestA);
  const resultB = runWalkForwardRequest(requestB);
  assert.equal(resultA.status, "PASS", JSON.stringify(resultA.failures));
  assert.equal(resultB.status, "PASS", JSON.stringify(resultB.failures));
  assert.deepEqual(resultA.windows[0].selectedParameter, resultB.windows[0].selectedParameter);
});

test("a window with an impossibly high minimumTrades has no eligible candidate and fails", () => {
  const candles = trendingCandles(400);
  const request = baseRequest(candles);
  request.minimumTrades = 1_000_000;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("ALL_CANDIDATES_INVALID")));
});

test("every selected parameter is a member of the declared parameterGrid", () => {
  const result = runWalkForwardRequest(baseRequest(trendingCandles(500)));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const gridKeys = new Set(result.parameterGrid.map((p) => `${p.shortWindow}/${p.longWindow}`));
  for (const window of result.windows) assert.ok(gridKeys.has(`${window.selectedParameter.shortWindow}/${window.selectedParameter.longWindow}`));
});

test("compareTieBreak prefers lower maxDrawdown first", () => {
  const a = { param: { shortWindow: 5, longWindow: 20 }, result: { metrics: { maxDrawdown: 0.1, turnover: 1 }, performance: { profitFactor: 1 } } };
  const b = { param: { shortWindow: 3, longWindow: 15 }, result: { metrics: { maxDrawdown: 0.2, turnover: 1 }, performance: { profitFactor: 1 } } };
  assert.ok(compareTieBreak(a, b) < 0);
});

test("compareTieBreak falls back to higher profitFactor when drawdown ties", () => {
  const a = { param: { shortWindow: 5, longWindow: 20 }, result: { metrics: { maxDrawdown: 0.1, turnover: 1 }, performance: { profitFactor: 2 } } };
  const b = { param: { shortWindow: 3, longWindow: 15 }, result: { metrics: { maxDrawdown: 0.1, turnover: 1 }, performance: { profitFactor: 1 } } };
  assert.ok(compareTieBreak(a, b) < 0);
});

test("compareTieBreak finally falls back to ascending shortWindow, then longWindow", () => {
  const a = { param: { shortWindow: 3, longWindow: 20 }, result: { metrics: { maxDrawdown: 0.1, turnover: 1 }, performance: { profitFactor: 1 } } };
  const b = { param: { shortWindow: 5, longWindow: 20 }, result: { metrics: { maxDrawdown: 0.1, turnover: 1 }, performance: { profitFactor: 1 } } };
  assert.ok(compareTieBreak(a, b) < 0);
});

test("running with a validation window can select a different parameter than training-only would", () => {
  const candles = trendingCandles(500);
  const withValidation = runWalkForwardRequest(baseRequest(candles));
  const noValidationRequest = baseRequest(candles);
  noValidationRequest.windows.validationCandles = 0;
  const withoutValidation = runWalkForwardRequest(noValidationRequest);
  assert.equal(withValidation.status, "PASS", JSON.stringify(withValidation.failures));
  assert.equal(withoutValidation.status, "PASS", JSON.stringify(withoutValidation.failures));
  // Not asserting they differ (that depends on the data), only that both run to
  // completion under the documented, distinct selection paths.
  assert.ok(withValidation.windows[0].validation != null);
  assert.equal(withoutValidation.windows[0].validation, null);
});
