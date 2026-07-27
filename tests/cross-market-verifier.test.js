const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation } = require("../scripts/lib/cross-market-validation-runner.js");
const { verifyCrossMarketResult } = require("../scripts/lib/cross-market-validation-verifier.js");

const dir = path.join(__dirname, "fixtures", "cross-market");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("the verifier PASSes on every untouched fixture", () => {
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const request = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const result = runCrossMarketValidation(request);
    const verification = verifyCrossMarketResult(request, result);
    assert.equal(verification.status, "PASS", `${name}: ${JSON.stringify(verification.errors)}`);
  }
});

test("the verifier detects a missing cell", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.fullAvailablePeriod.cells = result.fullAvailablePeriod.cells.slice(1);
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("missing cell") || m.includes("cell count")));
});

test("the verifier detects a strategy that differs from the request (fairness parity)", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.strategy = { ...result.strategy, shortWindow: 9 };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("strategy does not match")));
});

test("the verifier detects altered cost conditions (fairness parity)", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.costConditions = result.costConditions.map((c) => c.name === "SEVERE" ? { ...c, feeRate: 0 } : c);
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("cost conditions do not match") || m.includes("less stressful")));
});

test("the verifier detects a tampered positive-cell ratio", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.fullAvailablePeriod.aggregate = { ...result.fullAvailablePeriod.aggregate, positiveCellRatio: 1 };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("positiveCellRatio")));
});

test("the verifier detects a market summary whose positive count was inflated", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.fullAvailablePeriod.marketSummaries[0] = { ...result.fullAvailablePeriod.marketSummaries[0], positiveCellCount: 99 };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("positiveCellCount mismatch")));
});

test("the verifier detects a beatsBuyAndHold flag that disagrees with its own numbers", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  const index = result.fullAvailablePeriod.cells.findIndex((cell) => cell.status === "PASS");
  result.fullAvailablePeriod.cells[index] = { ...result.fullAvailablePeriod.cells[index], beatsBuyAndHold: !result.fullAvailablePeriod.cells[index].beatsBuyAndHold };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("beatsBuyAndHold")));
});

test("the verifier rejects a BROADLY_GENERALIZABLE label that its own numbers do not support", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.fullAvailablePeriod.aggregate = { ...result.fullAvailablePeriod.aggregate, positiveCellRatio: result.fullAvailablePeriod.aggregate.positiveCellRatio };
  // Force a market with no wins, then claim broad generalization anyway.
  const target = result.fullAvailablePeriod.marketSummaries[0].key;
  for (const cell of result.fullAvailablePeriod.cells) {
    if (cell.symbol === target && cell.status === "PASS") {
      cell.byCondition.BASE.totalReturn = -0.5;
      cell.beatsCash = false;
      cell.beatsBuyAndHold = false;
    }
  }
  result.fullAvailablePeriod.generalizationAssessment = "BROADLY_GENERALIZABLE";
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("BROADLY_GENERALIZABLE")));
});

test("the verifier requires survivorship bias to be disclosed", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.selectionBiasDisclosure = { ...result.selectionBiasDisclosure, survivorshipBiasPresent: false };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("survivorship bias")));
});

test("the verifier detects a tampered requestSha256", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.hashes = { ...result.hashes, requestSha256: "0".repeat(64) };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("requestSha256")));
});

test("the verifier detects an altered market-summary hash", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  result.fullAvailablePeriod.marketSummaries[0].medianReturn += 1;
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("marketSummarySha256")));
});

test("the verifier detects a common-period cell claiming more candles than its full-period counterpart", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  const index = result.commonPeriod.cells.findIndex((cell) => cell.status !== "BLOCKED");
  result.commonPeriod.cells[index] = { ...result.commonPeriod.cells[index], evaluatedCandleCount: 999_999 };
  const verification = verifyCrossMarketResult(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("more candles than its full-period counterpart")));
});
