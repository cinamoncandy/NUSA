const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runWalkForwardRequest } = require("../scripts/lib/walk-forward-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}

function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest() {
  return {
    schemaVersion: 1,
    id: "WF-DETERMINISM-001",
    market: "KRW-BTC",
    candles: trendingCandles(400),
    windows: { trainingCandles: 150, validationCandles: 30, testCandles: 60, stepCandles: 60 },
    parameterGrid: [
      { shortWindow: 2, longWindow: 8 }, { shortWindow: 3, longWindow: 12 }, { shortWindow: 4, longWindow: 16 }, { shortWindow: 5, longWindow: 20 }
    ],
    selectionMetric: "RETURN_OVER_DRAWDOWN",
    minimumTrades: 1,
    execution: { initialCash: 10_000_000, feeRate: 0.0005, executionCosts: { spreadBps: 0, slippageBps: 5 }, latencyCandles: 0, riskPolicy: {} }
  };
}

test("running the same request twice produces identical status, aggregate, and hashes", () => {
  const request = baseRequest();
  const first = runWalkForwardRequest(request);
  const second = runWalkForwardRequest(request);
  assert.equal(first.status, second.status);
  assert.deepEqual(first.aggregate, second.aggregate);
  assert.deepEqual(first.hashes, second.hashes);
  assert.equal(first.hashes.requestSha256, second.hashes.requestSha256);
});

test("requestSha256 changes when any request field changes", () => {
  const request = baseRequest();
  const first = runWalkForwardRequest(request);
  const mutated = baseRequest();
  mutated.minimumTrades = 2;
  const second = runWalkForwardRequest(mutated);
  assert.notEqual(first.hashes.requestSha256, second.hashes.requestSha256);
});

test("CLI wrapper refuses to overwrite an existing output file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cli-test-"));
  const requestPath = path.join(dir, "request.json");
  const outputPath = path.join(dir, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(baseRequest()));

  const first = spawnSync(process.execPath, ["scripts/run-walk-forward.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(outputPath));

  const second = spawnSync(process.execPath, ["scripts/run-walk-forward.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /refusing to overwrite/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI wrapper writes a result whose independent verification status is PASS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cli-test-"));
  const requestPath = path.join(dir, "request.json");
  const outputPath = path.join(dir, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(baseRequest()));

  const run = spawnSync(process.execPath, ["scripts/run-walk-forward.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(written.result.status, "PASS", JSON.stringify(written.result.failures));
  assert.equal(written.verification.status, "PASS", JSON.stringify(written.verification.errors));

  fs.rmSync(dir, { recursive: true, force: true });
});
