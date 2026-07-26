const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1,
    id: "ROBUST-TEST-001",
    market: "KRW-BTC",
    candles: trendingCandles(300),
    referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    neighborhood: { shortOffsets: [-2, -1, 0, 1, 2], longOffsets: [-5, -2, 0, 2, 5] },
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode: "FULL_SAMPLE" },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
}

test("a well-formed request runs without schema failures", () => {
  const result = runParameterRobustnessRequest(baseRequest());
  assert.deepEqual(result.failures, []);
});

test("missing schemaVersion is rejected", () => {
  const request = baseRequest(); delete request.schemaVersion;
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("schemaVersion")));
});

test("an empty referenceParameters array is rejected", () => {
  const request = baseRequest(); request.referenceParameters = [];
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
});

test("a reference with longWindow <= shortWindow is rejected", () => {
  const request = baseRequest(); request.referenceParameters[0] = { source: "PRODUCTION_DEFAULT", shortWindow: 20, longWindow: 5 };
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
});

test("an unknown reference source is rejected", () => {
  const request = baseRequest(); request.referenceParameters[0].source = "GUESS";
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("invalid source")));
});

test("neighborhood offsets must be non-empty integer arrays", () => {
  const request = baseRequest(); request.neighborhood.shortOffsets = [];
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
});

test("an unsupported evaluation.mode is rejected", () => {
  const request = baseRequest(); request.evaluation.mode = "SHARPE_ONLY";
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
});

test("WALK_FORWARD_OOS_WINDOWS mode requires oosWindows to be present and valid", () => {
  const request = baseRequest(); request.evaluation = { mode: "WALK_FORWARD_OOS_WINDOWS" };
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("oosWindows")));
});

test("costConditions must contain exactly BASE, MODERATE, and SEVERE", () => {
  const request = baseRequest(); request.costConditions = request.costConditions.slice(0, 2);
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("exactly 3 entries")));
});

test("MODERATE cannot be less stressful than BASE", () => {
  const request = baseRequest();
  request.costConditions = [
    { name: "BASE", feeRate: 0.002, slippageBps: 30 },
    { name: "MODERATE", feeRate: 0.0005, slippageBps: 5 },
    { name: "SEVERE", feeRate: 0.003, slippageBps: 40 }
  ];
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("MODERATE must not be less stressful")));
});

test("a non-zero execution.latencyCandles is rejected", () => {
  const request = baseRequest(); request.execution.latencyCandles = 1;
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
});
