const test = require("node:test");
const assert = require("node:assert/strict");
const { runWalkForwardRequest } = require("../scripts/lib/walk-forward-runner.js");
const { verifyWalkForwardResult } = require("../scripts/lib/walk-forward-verifier.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}

function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1,
    id: "WF-VERIFIER-001",
    market: "KRW-BTC",
    candles: trendingCandles(500),
    windows: { trainingCandles: 150, validationCandles: 30, testCandles: 60, stepCandles: 60 },
    parameterGrid: [
      { shortWindow: 2, longWindow: 8 }, { shortWindow: 3, longWindow: 12 }, { shortWindow: 4, longWindow: 16 }, { shortWindow: 5, longWindow: 20 }, { shortWindow: 6, longWindow: 24 }
    ],
    selectionMetric: "RETURN_OVER_DRAWDOWN",
    minimumTrades: 1,
    execution: { initialCash: 10_000_000, feeRate: 0.0005, executionCosts: { spreadBps: 0, slippageBps: 5 }, latencyCandles: 0, riskPolicy: {} }
  };
}

test("the verifier PASSes on an untouched result", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "PASS", JSON.stringify(verification.errors));
});

test("the verifier detects a tampered window boundary", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.windows[0].boundaries = { ...result.windows[0].boundaries, testEndIndex: result.windows[0].boundaries.testEndIndex + 5 };
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("boundary")));
});

test("the verifier detects an altered aggregate compoundedOosReturn", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.aggregate = { ...result.aggregate, compoundedOosReturn: result.aggregate.compoundedOosReturn + 1 };
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("compoundedOosReturn")));
});

test("the verifier detects a tampered aggregateResultSha256 (altered aggregate not reflected in hash)", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.aggregate = { ...result.aggregate, totalFees: result.aggregate.totalFees + 1_000 };
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("aggregateResultSha256")));
});

test("the verifier detects a selected parameter that does not exist in the declared grid", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.windows[0] = { ...result.windows[0], selectedParameter: { shortWindow: 99, longWindow: 100 } };
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("not in the declared parameterGrid")));
});

test("the verifier detects a selection that ignored a higher-scoring eligible candidate (no-validation case)", () => {
  const request = baseRequest();
  request.windows.validationCandles = 0;
  const result = runWalkForwardRequest(request);
  const window = result.windows[0];
  const eligible = window.candidateEvaluations.filter((c) => c.eligible);
  const worst = [...eligible].sort((a, b) => a.score - b.score)[0];
  const best = [...eligible].sort((a, b) => b.score - a.score)[0];
  if (worst.score < best.score) {
    result.windows[0] = { ...window, selectedParameter: { shortWindow: worst.shortWindow, longWindow: worst.longWindow } };
    const verification = verifyWalkForwardResult(request, result);
    assert.equal(verification.status, "FAIL");
    assert.ok(verification.errors.some((m) => m.includes("higher-scoring eligible candidate")));
  }
});

test("the verifier detects a tampered requestSha256", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.hashes = { ...result.hashes, requestSha256: "0".repeat(64) };
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("requestSha256")));
});

test("the verifier detects a missing window", () => {
  const request = baseRequest();
  const result = runWalkForwardRequest(request);
  result.windows = result.windows.slice(1);
  const verification = verifyWalkForwardResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("missing window") || m.includes("mismatch")));
});
