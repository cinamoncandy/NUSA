const test = require("node:test");
const assert = require("node:assert/strict");
const { runWalkForwardRequest } = require("../scripts/lib/walk-forward-runner.js");

function candle(openTime, overrides = {}) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: 100, high: 110, low: 90, close: 105, volume: 1, ...overrides };
}

function baseRequest(candleCount = 260) {
  const candles = [];
  for (let i = 0; i < candleCount; i += 1) candles.push(candle(i * 60_000, { close: 100 + Math.sin(i / 5) * 10 }));
  return {
    schemaVersion: 1,
    id: "WF-TEST-001",
    market: "KRW-BTC",
    candles,
    windows: { trainingCandles: 100, validationCandles: 20, testCandles: 40, stepCandles: 40 },
    parameterGrid: [
      { shortWindow: 2, longWindow: 8 }, { shortWindow: 3, longWindow: 12 }, { shortWindow: 4, longWindow: 16 }, { shortWindow: 5, longWindow: 20 }
    ],
    selectionMetric: "RETURN_OVER_DRAWDOWN",
    minimumTrades: 1,
    execution: { initialCash: 10_000_000, feeRate: 0.0005, executionCosts: { spreadBps: 0, slippageBps: 5 }, latencyCandles: 0, riskPolicy: {} }
  };
}

test("a well-formed request is accepted (execution runs, may PASS or FAIL on trade content but not on schema)", () => {
  const result = runWalkForwardRequest(baseRequest());
  assert.notEqual(result.failures?.length, undefined);
  assert.deepEqual(result.failures, []);
});

test("missing schemaVersion is rejected", () => {
  const request = baseRequest(); delete request.schemaVersion;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("schemaVersion")));
});

test("empty candles array is rejected", () => {
  const request = baseRequest(); request.candles = [];
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
});

test("stepCandles smaller than testCandles is rejected (would overlap test windows)", () => {
  const request = baseRequest(); request.windows.stepCandles = 10; request.windows.testCandles = 40;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("stepCandles")));
});

test("fewer than 4 parameterGrid candidates is rejected", () => {
  const request = baseRequest(); request.parameterGrid = request.parameterGrid.slice(0, 2);
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("parameterGrid must contain")));
});

test("more than 12 parameterGrid candidates is rejected", () => {
  const request = baseRequest();
  request.parameterGrid = Array.from({ length: 13 }, (_, i) => ({ shortWindow: i + 1, longWindow: i + 30 }));
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
});

test("a duplicate parameterGrid tuple is rejected", () => {
  const request = baseRequest();
  request.parameterGrid.push({ ...request.parameterGrid[0] });
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("duplicate parameterGrid tuple")));
});

test("longWindow <= shortWindow is rejected", () => {
  const request = baseRequest();
  request.parameterGrid[0] = { shortWindow: 10, longWindow: 5 };
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
});

test("longWindow >= trainingCandles is rejected (cannot warm up within training)", () => {
  const request = baseRequest();
  request.parameterGrid[0] = { shortWindow: 5, longWindow: request.windows.trainingCandles };
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("smaller than windows.trainingCandles")));
});

test("an unsupported selectionMetric is rejected", () => {
  const request = baseRequest(); request.selectionMetric = "SHARPE";
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("selectionMetric")));
});

test("a non-zero execution.latencyCandles is rejected (not supported by the reused BacktestEngine)", () => {
  const request = baseRequest(); request.execution.latencyCandles = 1;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("latencyCandles")));
});

test("a negative minimumTrades is rejected", () => {
  const request = baseRequest(); request.minimumTrades = -1;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
});

test("a non-positive execution.initialCash is rejected", () => {
  const request = baseRequest(); request.execution.initialCash = 0;
  const result = runWalkForwardRequest(request);
  assert.equal(result.status, "FAIL");
});
