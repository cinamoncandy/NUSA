const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation } = require("../scripts/lib/cross-market-validation-runner.js");

const fixturePath = path.join(__dirname, "fixtures", "cross-market", "multi-market-multi-period.json");
const loadRequest = () => JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("a well-formed multi-market request runs without validation failures", () => {
  const result = runCrossMarketValidation(loadRequest());
  assert.deepEqual(result.failures, []);
  assert.equal(result.status, "PASS");
});

test("missing schemaVersion is rejected", () => {
  const request = loadRequest(); delete request.schemaVersion;
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("schemaVersion")));
});

test("an unsupported strategy kind is rejected", () => {
  const request = loadRequest(); request.strategy.kind = "DEEP_LEARNING";
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("strategy.kind")));
});

test("a single symbol is rejected -- cross-market validation needs at least two", () => {
  const request = loadRequest();
  request.datasets = request.datasets.filter((dataset) => dataset.symbol === "KRW-BTC");
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("at least 2 distinct symbols")));
});

test("a single period is rejected -- cross-period validation needs at least two", () => {
  const request = loadRequest();
  request.datasets = request.datasets.filter((dataset) => dataset.periodLabel === "P1");
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("at least 2 distinct period labels")));
});

test("a duplicate market/period cell is rejected", () => {
  const request = loadRequest();
  request.datasets.push({ ...request.datasets[0], datasetId: "BTC-P1-COPY" });
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("duplicate market/period cell")));
});

test("a duplicate datasetId is rejected", () => {
  const request = loadRequest();
  request.datasets.push({ ...request.datasets[0], periodLabel: "P3" });
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("duplicate datasetId")));
});

test("mixed timeframes are rejected as not comparable", () => {
  const request = loadRequest();
  const target = request.datasets[2];
  target.candles = target.candles.map((candle) => ({ ...candle, interval: "5m", closeTime: candle.openTime + 300_000 }));
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("mixed timeframes") || m.includes("candles failed validation")));
});

test("a candle whose market disagrees with the declared symbol is rejected", () => {
  const request = loadRequest();
  request.datasets[0].symbol = "KRW-DOGE";
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("does not match declared symbol")));
});

test("a non-zero execution.latencyCandles is rejected", () => {
  const request = loadRequest(); request.execution.latencyCandles = 1;
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("latencyCandles")));
});

test("cost conditions that are not monotonically more stressful are rejected", () => {
  const request = loadRequest();
  request.costConditions = [
    { name: "BASE", feeRate: 0.002, slippageBps: 30 },
    { name: "MODERATE", feeRate: 0.0005, slippageBps: 5 },
    { name: "SEVERE", feeRate: 0.003, slippageBps: 40 }
  ];
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("less stressful")));
});

test("longWindow must exceed shortWindow", () => {
  const request = loadRequest();
  request.strategy = { kind: "SMA_CROSSOVER", shortWindow: 20, longWindow: 5 };
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "FAIL");
});
