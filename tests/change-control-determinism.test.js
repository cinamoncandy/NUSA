const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { analyzeChangeImpact } = require("../scripts/lib/change-impact-analyzer.js");

const fixturesDir = path.join(__dirname, "fixtures", "change-control");
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));

test("analyzing the same change set twice produces an identical result and identical hashes", () => {
  const changeSet = loadFixture("mixed-high-risk-change");
  const first = analyzeChangeImpact(changeSet);
  const second = analyzeChangeImpact(changeSet);
  assert.deepEqual(first.categories, second.categories);
  assert.equal(first.riskLevel, second.riskLevel);
  assert.deepEqual(first.invalidatedEvidence, second.invalidatedEvidence);
  assert.deepEqual(first.requiredStages, second.requiredStages);
  assert.deepEqual(first.hashes, second.hashes);
});

test("changing a single line changes the change-set hash", () => {
  const first = analyzeChangeImpact(loadFixture("docs-only"));
  const mutated = loadFixture("docs-only");
  mutated.changedFiles[0].addedLines = ["something else"];
  const second = analyzeChangeImpact(mutated);
  assert.notEqual(first.hashes.changeSetSha256, second.hashes.changeSetSha256);
});

test("category ordering is canonical and independent of changed-file ordering", () => {
  const changeSet = loadFixture("mixed-high-risk-change");
  const reversed = { ...changeSet, changedFiles: [...changeSet.changedFiles].reverse() };
  assert.deepEqual(analyzeChangeImpact(changeSet).categories, analyzeChangeImpact(reversed).categories);
});

test("the result is JSON-serializable and the input change set is not mutated", () => {
  const changeSet = loadFixture("strategy-parameter-change");
  const before = JSON.parse(JSON.stringify(changeSet));
  const result = analyzeChangeImpact(changeSet);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(changeSet, before);
});

test("CLI refuses to overwrite an existing output file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "change-control-cli-"));
  const changeSetPath = path.join(dir, "change-set.json");
  const outputPath = path.join(dir, "impact.json");
  fs.writeFileSync(changeSetPath, JSON.stringify(loadFixture("docs-only")));

  const first = spawnSync(process.execPath, ["scripts/analyze-change-impact.js", "--change-set", changeSetPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);

  const second = spawnSync(process.execPath, ["scripts/analyze-change-impact.js", "--change-set", changeSetPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /refusing to overwrite/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI exits non-zero on a LEVEL_5 change so a pipeline cannot proceed past it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "change-control-cli-"));
  const changeSetPath = path.join(dir, "change-set.json");
  const outputPath = path.join(dir, "impact.json");
  fs.writeFileSync(changeSetPath, JSON.stringify(loadFixture("live-capability-addition")));

  const run = spawnSync(process.execPath, ["scripts/analyze-change-impact.js", "--change-set", changeSetPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /BLOCKER/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the standalone verifier CLI re-verifies a written result and exits zero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "change-control-cli-"));
  const changeSetPath = path.join(dir, "change-set.json");
  const outputPath = path.join(dir, "impact.json");
  fs.writeFileSync(changeSetPath, JSON.stringify(loadFixture("installer-change")));

  const analyze = spawnSync(process.execPath, ["scripts/analyze-change-impact.js", "--change-set", changeSetPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(analyze.status, 0, analyze.stderr);

  const verify = spawnSync(process.execPath, ["scripts/verify-change-control.js", "--change-set", changeSetPath, "--result", outputPath], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /PASS/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the verifier CLI exits non-zero when the written result was tampered with", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "change-control-cli-"));
  const changeSetPath = path.join(dir, "change-set.json");
  const outputPath = path.join(dir, "impact.json");
  fs.writeFileSync(changeSetPath, JSON.stringify(loadFixture("strategy-parameter-change")));

  spawnSync(process.execPath, ["scripts/analyze-change-impact.js", "--change-set", changeSetPath, "--output", outputPath], { encoding: "utf8" });
  const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  written.result.requiredApprovals = ["MAINTAINER"];
  fs.writeFileSync(outputPath, JSON.stringify(written));

  const verify = spawnSync(process.execPath, ["scripts/verify-change-control.js", "--change-set", changeSetPath, "--result", outputPath], { encoding: "utf8" });
  assert.equal(verify.status, 1);
  assert.match(verify.stdout, /ERROR/);

  fs.rmSync(dir, { recursive: true, force: true });
});
