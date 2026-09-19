"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");
const { verifyParameterRobustnessResult } = require("../scripts/lib/parameter-robustness-verifier.js");
const { canonicalHash } = require("../scripts/lib/canonical-hash.js");

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

test("different candidate names cannot multiply the same parameter evidence", () => {
  const input = request();
  input.candidateGrid.push({ ...structuredClone(input.candidateGrid[0]), key: "duplicate", neighbors: [] });
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "FAIL");
  assert.equal(result.candidates.length, 0, "reject before evaluating any candidate");
  assert.match(result.failures.join(";"), /duplicate.*parameters/i);
});

for (const [name, mutate] of [
  ["missing parameter must not invoke a constructor default", (input) => { delete input.candidateGrid[0].parameters.period; }],
  ["unknown parameter must not be ignored", (input) => { input.candidateGrid[0].parameters.unused = 1; }],
  ["whitespace parameter must not be silently renamed", (input) => { input.candidateGrid[0].parameters[" period"] = 9; }],
  ["non-finite parameter must fail closed", (input) => { input.candidateGrid[0].parameters.period = NaN; }],
  ["numeric string must not become a parameter", (input) => { input.candidateGrid[0].parameters.period = "7"; }],
  ["null grid row must fail closed", (input) => { input.candidateGrid.push(null); }],
  ["non-array grid must fail closed", (input) => { input.candidateGrid = {}; }],
  ["whitespace candidate key must not become another identity", (input) => { input.candidateGrid[0].key = " padded "; }],
]) {
  test(name, () => {
    const input = request();
    mutate(input);
    // A matching reference must not conceal a missing/unused parameter contract.
    if (Array.isArray(input.candidateGrid) && input.candidateGrid[0]?.parameters) {
      input.referenceParameters[1].parameters = structuredClone(input.candidateGrid[0].parameters);
    }
    const result = runParameterRobustnessRequest(input);
    assert.equal(result.status, "FAIL");
    assert.equal(result.candidates.length, 0);
  });
}

test("reference evidence binds source AND candidate, not the first matching source", () => {
  const input = request();
  input.referenceParameters[1].source = input.referenceParameters[0].source;
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "PASS");
  assert.deepEqual(verifyParameterRobustnessResult(input, result), { status: "PASS", errors: [] });
  result.references.push(structuredClone(result.references[0]));
  assert.equal(verifyParameterRobustnessResult(input, result).status, "FAIL");
});

test("SMA aliases preserve valid input but cannot masquerade as a distinct candidate", () => {
  const input = request();
  input.strategyFamily = "sma-crossover";
  input.candidateGrid = [
    { key: "canonical", parameters: { shortPeriod: 5, longPeriod: 20 }, neighbors: ["legacy"] },
    { key: "legacy", parameters: { shortWindow: 10, longWindow: 30 }, neighbors: ["canonical"] },
  ];
  input.referenceParameters = input.candidateGrid.map((entry) => ({ source: "MANUAL_RESEARCH_REFERENCE", candidateKey: entry.key, parameters: entry.parameters }));
  const valid = runParameterRobustnessRequest(input);
  assert.equal(valid.status, "PASS", valid.failures.join(";"));
  assert.equal(verifyParameterRobustnessResult(input, valid).status, "PASS");
  input.candidateGrid[1].parameters.shortWindow = 5;
  input.candidateGrid[1].parameters.longWindow = 20;
  const duplicate = runParameterRobustnessRequest(input);
  assert.equal(duplicate.status, "FAIL");
  assert.match(duplicate.failures.join(";"), /duplicate strategy parameters/);
});

test("SMA conflicting aliases and duplicate references are rejected before evaluation", () => {
  const input = request();
  input.strategyFamily = "sma-crossover";
  input.candidateGrid = [{ key: "ambiguous", parameters: { shortPeriod: 5, shortWindow: 10, longPeriod: 20 }, neighbors: [] }];
  const ref = { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "ambiguous", parameters: input.candidateGrid[0].parameters };
  input.referenceParameters = [ref, structuredClone(ref)];
  const result = runParameterRobustnessRequest(input);
  assert.equal(result.status, "FAIL");
  assert.match(result.failures.join(";"), /ambiguous strategy parameter/);
  assert.match(result.failures.join(";"), /duplicate source\/candidate identity/);
});

test("independent verification rejects malformed and mismatched family receipts", () => {
  const input = donchianRequest();
  const valid = runParameterRobustnessRequest(input);
  for (const mutate of [
    (r) => { r.strategyFamily = "rsi-mean-reversion"; },
    (r) => { r.requestId = "different-request"; },
    (r) => { r.references[0].familyId = "sma-crossover"; },
    (r) => { r.costConditions[2].feeRate *= 2; },
    (r) => { r.candidates = null; },
    (r) => { r.references.push(null); },
    (r) => { r.references.pop(); },
    (r) => { r.candidates[0].costResults = null; },
  ]) {
    const corrupted = structuredClone(valid);
    mutate(corrupted);
    assert.equal(verifyParameterRobustnessResult(input, corrupted).status, "FAIL");
  }
  assert.deepEqual(runParameterRobustnessRequest(input), valid, "unchanged input has deterministic output");
});

test("rehashing a duplicate family configuration cannot make its evidence valid", () => {
  const input = request();
  const result = runParameterRobustnessRequest(input);
  input.candidateGrid[1].parameters = structuredClone(input.candidateGrid[0].parameters);
  result.candidates.find((candidate) => candidate.candidateKey === input.candidateGrid[1].key).parameters = structuredClone(input.candidateGrid[1].parameters);
  result.hashes.requestSha256 = canonicalHash(input);
  result.hashes.neighborhoodGridSha256 = canonicalHash(input.candidateGrid);
  result.hashes.candidateResultsSha256 = canonicalHash(result.candidates);
  const verification = verifyParameterRobustnessResult(input, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.includes("request contains duplicate strategy parameters"));
});
