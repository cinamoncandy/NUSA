const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");
const { verifyParameterRobustnessResult } = require("../scripts/lib/parameter-robustness-verifier.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1,
    id: "ROBUST-VERIFIER-001",
    market: "KRW-BTC",
    candles: trendingCandles(400),
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

test("the verifier PASSes on an untouched result", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "PASS", JSON.stringify(verification.errors));
});

test("the verifier detects a missing candidate", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  result.candidates = result.candidates.slice(1);
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("missing candidate") || m.includes("size mismatch")));
});

test("the verifier detects a tampered distanceFromReferences value", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  const candidate = result.candidates.find((c) => c.shortWindow !== 5 || c.longWindow !== 20);
  candidate.distanceFromReferences = candidate.distanceFromReferences.map((d) => ({ ...d, short: d.short + 100 }));
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("distance from")));
});

test("the verifier detects a costConditions block edited to make MODERATE less stressful than BASE", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  result.costConditions = result.costConditions.map((c) => c.name === "MODERATE" ? { ...c, feeRate: 0, slippageBps: 0 } : c);
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("less stressful")));
});

test("the verifier detects a mislabeled BROAD_PLATEAU assessment on a non-positive reference return", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  result.references[0] = { ...result.references[0], referenceReturn: -1, assessment: "BROAD_PLATEAU" };
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("BROAD_PLATEAU requires a positive")));
});

test("the verifier detects a tampered aggregateResultSha256", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  result.aggregate = { ...result.aggregate, positiveRatio: 0.999999 };
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("aggregateResultSha256") || m.includes("positiveRatio")));
});

test("the verifier detects a tampered requestSha256", () => {
  const request = baseRequest();
  const result = runParameterRobustnessRequest(request);
  result.hashes = { ...result.hashes, requestSha256: "0".repeat(64) };
  const verification = verifyParameterRobustnessResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("requestSha256")));
});
