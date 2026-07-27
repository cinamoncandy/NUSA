const test = require("node:test");
const assert = require("node:assert/strict");
const { runRegimeAnalysisRequest } = require("../scripts/lib/regime-analysis-runner.js");
const { verifyRegimeAnalysisResult } = require("../scripts/lib/regime-analysis-verifier.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function wavyCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1, id: "REGIME-VERIFIER-001", market: "KRW-BTC", candles: wavyCandles(500),
    strategy: { shortWindow: 5, longWindow: 20 },
    classifier: {
      trendLookback: 60, volatilityLookback: 60, liquidityLookback: 60,
      trendThreshold: 0.01, lowVolatilityThreshold: 0.0005, highVolatilityThreshold: 0.002,
      lowLiquidityThreshold: 0.5, highLiquidityThreshold: 1.5,
      minimumSamples: 60, classifierVersion: "wo0029-v1"
    },
    thresholdSource: "FIXED_ABSOLUTE",
    minimumSample: { candles: 20, segments: 1, trades: 1 },
    transitionWindow: { preCandles: 10, postCandles: 10 },
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
}

test("the verifier PASSes on an untouched result", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "PASS", JSON.stringify(verification.errors));
});

test("the verifier detects an altered regime label (independent reclassification disagrees)", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.hashes = { ...result.hashes, labelsSha256: "0".repeat(64) };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("labelsSha256")));
});

test("the verifier detects a segment gap", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.segments = result.segments.filter((_, index) => index !== 1);
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("gap or overlap") || m.includes("segments cover")));
});

test("the verifier detects a segment whose candleCount does not match its range", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.segments[0] = { ...result.segments[0], candleCount: result.segments[0].candleCount + 5 };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("candleCount does not match")));
});

test("the verifier detects a broken trade-count partition", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.aggregate = { ...result.aggregate, totalTrades: result.aggregate.totalTrades + 3 };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("not a partition")));
});

test("the verifier detects a broken PnL reconciliation", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.aggregate = { ...result.aggregate, totalNetPnL: result.aggregate.totalNetPnL + 1_000 };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("PnL reconciliation")));
});

test("the verifier rejects an UNKNOWN bucket that was given a performance grade", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  const index = result.regimes.findIndex((regime) => regime.trend === "UNKNOWN" || regime.volatility === "UNKNOWN");
  if (index >= 0) {
    result.regimes[index] = { ...result.regimes[index], assessment: "STRONG" };
    const verification = verifyRegimeAnalysisResult(request, result);
    assert.equal(verification.status, "FAIL");
    assert.ok(verification.errors.some((m) => m.includes("UNKNOWN dimension but was graded")));
  }
});

test("the verifier rejects a STRONG grade that does not survive the SEVERE cost condition", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  const index = result.regimes.findIndex((regime) => regime.assessment !== "UNCLASSIFIED");
  result.regimes[index] = {
    ...result.regimes[index],
    assessment: "STRONG",
    byCondition: { ...result.regimes[index].byCondition, SEVERE: { ...result.regimes[index].byCondition.SEVERE, netPnL: -100 }, BASE: { ...result.regimes[index].byCondition.BASE, netPnL: 100 } }
  };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("does not survive the SEVERE")));
});

test("the verifier rejects a graded regime that is below the declared minimum sample", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  const index = result.regimes.findIndex((regime) => regime.assessment !== "UNCLASSIFIED");
  result.regimes[index] = {
    ...result.regimes[index],
    assessment: "ACCEPTABLE",
    byCondition: { ...result.regimes[index].byCondition, BASE: { ...result.regimes[index].byCondition.BASE, tradeCount: 0 } }
  };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("below the declared minimum sample")));
});

test("the verifier detects a tampered requestSha256", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.hashes = { ...result.hashes, requestSha256: "0".repeat(64) };
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("requestSha256")));
});

test("the verifier detects a costConditions block edited to make SEVERE less stressful than MODERATE", () => {
  const request = baseRequest();
  const result = runRegimeAnalysisRequest(request);
  result.costConditions = result.costConditions.map((c) => c.name === "SEVERE" ? { ...c, feeRate: 0, slippageBps: 0 } : c);
  const verification = verifyRegimeAnalysisResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("less stressful")));
});
