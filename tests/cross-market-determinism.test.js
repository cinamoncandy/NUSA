const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runCrossMarketValidation } = require("../scripts/lib/cross-market-validation-runner.js");

const dir = path.join(__dirname, "fixtures", "cross-market");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("running the same request twice produces identical cells, summaries, and hashes", () => {
  const request = load("basic-two-markets");
  const first = runCrossMarketValidation(request);
  const second = runCrossMarketValidation(request);
  assert.deepEqual(first.fullAvailablePeriod.cells, second.fullAvailablePeriod.cells);
  assert.deepEqual(first.fullAvailablePeriod.marketSummaries, second.fullAvailablePeriod.marketSummaries);
  assert.deepEqual(first.fullAvailablePeriod.periodSummaries, second.fullAvailablePeriod.periodSummaries);
  assert.deepEqual(first.hashes, second.hashes);
});

test("results do not depend on the order datasets are supplied in", () => {
  const request = load("basic-two-markets");
  const reversed = { ...request, datasets: [...request.datasets].reverse() };
  const forward = runCrossMarketValidation(request);
  const backward = runCrossMarketValidation(reversed);
  assert.deepEqual(forward.fullAvailablePeriod.cells, backward.fullAvailablePeriod.cells);
  assert.equal(forward.hashes.cellPlanSha256, backward.hashes.cellPlanSha256);
});

test("changing the strategy changes the strategy hash and the request hash", () => {
  const first = runCrossMarketValidation(load("basic-two-markets"));
  const mutated = load("basic-two-markets");
  mutated.strategy = { ...mutated.strategy, longWindow: 30 };
  const second = runCrossMarketValidation(mutated);
  assert.notEqual(first.hashes.strategySha256, second.hashes.strategySha256);
  assert.notEqual(first.hashes.requestSha256, second.hashes.requestSha256);
});

test("the result is JSON-serializable and the input request is not mutated", () => {
  const request = load("basic-two-markets");
  const before = JSON.parse(JSON.stringify(request));
  const result = runCrossMarketValidation(request);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(request, before);
});

test("CLI refuses to overwrite an existing output file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cross-market-cli-"));
  const requestPath = path.join(tmp, "request.json");
  const outputPath = path.join(tmp, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(load("basic-two-markets")));

  const first = spawnSync(process.execPath, ["scripts/run-cross-market-validation.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);

  const second = spawnSync(process.execPath, ["scripts/run-cross-market-validation.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /refusing to overwrite/);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CLI writes a result whose independent verification is PASS", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cross-market-cli-"));
  const requestPath = path.join(tmp, "request.json");
  const outputPath = path.join(tmp, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(load("basic-two-markets")));

  const run = spawnSync(process.execPath, ["scripts/run-cross-market-validation.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(written.result.status, "PASS");
  assert.equal(written.verification.status, "PASS", JSON.stringify(written.verification.errors));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CLI exits non-zero when the request is invalid", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cross-market-cli-"));
  const requestPath = path.join(tmp, "request.json");
  const outputPath = path.join(tmp, "result.json");
  const bad = load("basic-two-markets");
  delete bad.dataProvenance;
  fs.writeFileSync(requestPath, JSON.stringify(bad));

  const run = spawnSync(process.execPath, ["scripts/run-cross-market-validation.js", "--request", requestPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 1);

  fs.rmSync(tmp, { recursive: true, force: true });
});
