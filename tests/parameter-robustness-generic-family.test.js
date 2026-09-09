"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");
const { verifyParameterRobustnessResult } = require("../scripts/lib/parameter-robustness-verifier.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function candles(count = 300) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 5) * 3000 + Math.sin(i / 31) * 5000)));
}
function request() {
  return {
    schemaVersion: 1,
    id: "RSI-ROBUST-001",
    market: "KRW-BTC",
    candles: candles(),
    strategyFamily: "rsi-mean-reversion",
    candidateGrid: [
      { key: "rsi-7-25-75", parameters: { period: 7, oversold: 25, overbought: 75 }, neighbors: ["rsi-7-30-70", "rsi-14-25-75"] },
      { key: "rsi-7-30-70", parameters: { period: 7, oversold: 30, overbought: 70 }, neighbors: ["rsi-7-25-75", "rsi-14-30-70"] },
      { key: "rsi-14-25-75", parameters: { period: 14, oversold: 25, overbought: 75 }, neighbors: ["rsi-7-25-75", "rsi-14-30-70"] },
      { key: "rsi-14-30-70", parameters: { period: 14, oversold: 30, overbought: 70 }, neighbors: ["rsi-7-30-70", "rsi-14-25-75"] },
    ],
    referenceParameters: [
      { source: "PRODUCTION_DEFAULT", candidateKey: "rsi-14-30-70", parameters: { period: 14, oversold: 30, overbought: 70 } },
      { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "rsi-7-25-75", parameters: { period: 7, oversold: 25, overbought: 75 } },
    ],
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, orderQuantity: 0.001, executionCosts: { spreadBps: 5 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode: "BOTH", oosWindows: { trainingCandles: 120, testCandles: 20, stepCandles: 20 } },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.00075, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.001, slippageBps: 30 },
    ],
  };
}

test("generic robustness evaluates the exact precommitted RSI grid and verifies independently", () => {
  const input = request();
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "PASS", result.failures.join(","));
  assert.equal(result.strategyFamily, "rsi-mean-reversion");
  assert.equal(result.candidates.length, 4);
  assert.deepEqual(result.candidates.map((candidate) => candidate.candidateKey), ["rsi-14-25-75", "rsi-14-30-70", "rsi-7-25-75", "rsi-7-30-70"]);
  assert.equal(verifyParameterRobustnessResult(input, result).status, "PASS");
});

test("generic robustness fails closed on asymmetric or post-hoc adjacency", () => {
  const input = request();
  input.candidateGrid[0].neighbors = ["rsi-7-30-70"];
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("adjacency must be symmetric")));
});

function donchianRequest() {
  const input = request();
  input.id = "DONCHIAN-ROBUST-001";
  input.strategyFamily = "donchian-breakout";
  input.candidateGrid = [10, 20, 30, 40, 55].map((channelPeriod, index, periods) => ({
    key: `donchian-${channelPeriod}`,
    parameters: { channelPeriod },
    neighbors: [index > 0 ? `donchian-${periods[index - 1]}` : null, index + 1 < periods.length ? `donchian-${periods[index + 1]}` : null].filter(Boolean),
  }));
  input.referenceParameters = [
    { source: "PRODUCTION_DEFAULT", candidateKey: "donchian-20", parameters: { channelPeriod: 20 } },
    { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "donchian-55", parameters: { channelPeriod: 55 } },
  ];
  return input;
}

test("generic robustness evaluates the exact precommitted Donchian grid and verifies independently", () => {
  const input = donchianRequest();
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "PASS", result.failures.join(","));
  assert.equal(result.strategyFamily, "donchian-breakout");
  assert.equal(result.candidates.length, 5);
  assert.deepEqual(result.candidates.map((candidate) => candidate.candidateKey), ["donchian-10", "donchian-20", "donchian-30", "donchian-40", "donchian-55"]);
  assert.equal(verifyParameterRobustnessResult(input, result).status, "PASS");
});
