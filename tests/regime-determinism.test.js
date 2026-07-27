const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runRegimeAnalysisRequest } = require("../scripts/lib/regime-analysis-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function wavyCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1, id: "REGIME-DETERMINISM-001", market: "KRW-BTC", candles: wavyCandles(300),
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

test("running the same request twice produces identical labels, segments, aggregate, and hashes", () => {
  const request = baseRequest();
  const first = runRegimeAnalysisRequest(request);
  const second = runRegimeAnalysisRequest(request);
  assert.equal(first.status, second.status);
  assert.deepEqual(first.segments, second.segments);
  assert.deepEqual(first.aggregate, second.aggregate);
  assert.deepEqual(first.hashes, second.hashes);
});

test("changing a classifier threshold changes the labels hash", () => {
  const first = runRegimeAnalysisRequest(baseRequest());
  const mutated = baseRequest();
  mutated.classifier = { ...mutated.classifier, trendThreshold: 0.05 };
  const second = runRegimeAnalysisRequest(mutated);
  assert.notEqual(first.hashes.labelsSha256, second.hashes.labelsSha256);
  assert.notEqual(first.hashes.classificationConfigSha256, second.hashes.classificationConfigSha256);
});

test("the result is JSON-serializable and the input request is not mutated", () => {
  const request = baseRequest();
  const before = JSON.parse(JSON.stringify(request));
  const result = runRegimeAnalysisRequest(request);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(request, before);
});

test("CLI wrapper refuses to overwrite an existing output file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regime-cli-test-"));
  const requestPath = path.join(dir, "request.json");
  const outputPath = path.join(dir, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(baseRequest()));

  const first = spawnSync(process.execPath, ["scripts/run-regime-analysis.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(outputPath));

  const second = spawnSync(process.execPath, ["scripts/run-regime-analysis.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /refusing to overwrite/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI wrapper writes a result whose independent verification status is PASS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regime-cli-test-"));
  const requestPath = path.join(dir, "request.json");
  const outputPath = path.join(dir, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(baseRequest()));

  const run = spawnSync(process.execPath, ["scripts/run-regime-analysis.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(written.result.status, "PASS", JSON.stringify(written.result.failures));
  assert.equal(written.verification.status, "PASS", JSON.stringify(written.verification.errors));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("an unsupported thresholdSource is rejected rather than silently treated as absolute", () => {
  const request = baseRequest();
  request.thresholdSource = "TRAINING_QUANTILES";
  const result = runRegimeAnalysisRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("thresholdSource")));
});

test("a non-zero execution.latencyCandles is rejected", () => {
  const request = baseRequest();
  request.execution.latencyCandles = 1;
  const result = runRegimeAnalysisRequest(request);
  assert.equal(result.status, "FAIL");
});

test("an inverted volatility threshold pair is rejected by the reused classifier config validator", () => {
  const request = baseRequest();
  request.classifier = { ...request.classifier, lowVolatilityThreshold: 0.05, highVolatilityThreshold: 0.001 };
  const result = runRegimeAnalysisRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("classifier config is invalid")));
});

test("costConditions that are not monotonically more stressful are rejected", () => {
  const request = baseRequest();
  request.costConditions = [
    { name: "BASE", feeRate: 0.002, slippageBps: 30 },
    { name: "MODERATE", feeRate: 0.0005, slippageBps: 5 },
    { name: "SEVERE", feeRate: 0.003, slippageBps: 40 }
  ];
  const result = runRegimeAnalysisRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("less stressful")));
});
