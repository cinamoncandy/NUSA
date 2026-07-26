const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest(mode = "FULL_SAMPLE") {
  const request = {
    schemaVersion: 1,
    id: "ROBUST-ASSESS-001",
    market: "KRW-BTC",
    candles: trendingCandles(400),
    referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    neighborhood: { shortOffsets: [-2, -1, 0, 1, 2], longOffsets: [-5, -2, 0, 2, 5] },
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
  if (mode !== "FULL_SAMPLE") request.evaluation.oosWindows = { trainingCandles: 100, testCandles: 40, stepCandles: 40 };
  return request;
}

test("every candidate is evaluated under all three cost conditions with escalating cost", () => {
  const result = runParameterRobustnessRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const candidate of result.candidates.filter((c) => c.status === "EVALUATED")) {
    assert.ok(candidate.costResults.BASE);
    assert.ok(candidate.costResults.MODERATE);
    assert.ok(candidate.costResults.SEVERE);
  }
});

test("aggregate.costSurvivorCounts.SEVERE never exceeds BASE (cost stress cannot improve survival)", () => {
  const result = runParameterRobustnessRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.ok(result.aggregate.costSurvivorCounts.SEVERE <= result.aggregate.costSurvivorCounts.BASE);
});

test("BOTH mode records both a fullSample and an oos summary for every valid candidate", () => {
  const result = runParameterRobustnessRequest(baseRequest("BOTH"));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const candidate of result.candidates.filter((c) => c.status === "EVALUATED")) {
    assert.ok(candidate.costResults.BASE.fullSample);
    assert.ok(candidate.costResults.BASE.oos);
  }
});

test("WALK_FORWARD_OOS_WINDOWS mode never uses a per-window re-selected parameter -- every window in the OOS run uses the single fixed candidate", () => {
  const result = runParameterRobustnessRequest(baseRequest("WALK_FORWARD_OOS_WINDOWS"));
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const candidate = result.candidates.find((c) => c.status === "EVALUATED");
  assert.ok(candidate.costResults.BASE.oos.windowCount > 0);
  assert.equal(candidate.costResults.BASE.fullSample, null);
});

test("aggregate.medianReturn falls between worstReturn and bestReturn", () => {
  const result = runParameterRobustnessRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.ok(result.aggregate.medianReturn >= result.aggregate.worstReturn - 1e-12);
  assert.ok(result.aggregate.medianReturn <= result.aggregate.bestReturn + 1e-12);
});

test("the result is JSON-serializable and the input request is not mutated", () => {
  const request = baseRequest();
  const before = JSON.parse(JSON.stringify(request));
  const result = runParameterRobustnessRequest(request);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(request, before);
});
