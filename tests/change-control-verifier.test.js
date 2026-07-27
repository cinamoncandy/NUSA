const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyzeChangeImpact } = require("../scripts/lib/change-impact-analyzer.js");
const { verifyChangeControlResult } = require("../scripts/lib/change-control-verifier.js");

const fixturesDir = path.join(__dirname, "fixtures", "change-control");
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));

test("the verifier PASSes on every untouched fixture result", () => {
  for (const name of fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"))) {
    const changeSet = JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
    const result = analyzeChangeImpact(changeSet);
    const verification = verifyChangeControlResult(changeSet, result);
    assert.equal(verification.status, "PASS", `${name}: ${JSON.stringify(verification.errors)}`);
  }
});

test("the verifier detects an omitted changed file", () => {
  const changeSet = loadFixture("mixed-high-risk-change");
  const result = analyzeChangeImpact(changeSet);
  result.changedFiles = result.changedFiles.slice(1);
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("omitted from the analysis") || m.includes("count mismatch")));
});

test("the verifier independently catches a live capability that was graded below LEVEL_5", () => {
  const changeSet = loadFixture("live-capability-addition");
  const result = analyzeChangeImpact(changeSet);
  result.riskLevel = "LEVEL_1";
  result.riskLevelNumber = 1;
  result.changeDecision = "APPROVED_FOR_IMPLEMENTATION";
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("critical capability")));
});

test("the verifier independently catches a high-risk edit graded below LEVEL_4", () => {
  const changeSet = loadFixture("risk-limit-increase");
  const result = analyzeChangeImpact(changeSet);
  result.riskLevel = "LEVEL_1";
  result.riskLevelNumber = 1;
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("high-risk edits")));
});

test("the verifier catches evidence that was silently kept alive", () => {
  const changeSet = loadFixture("strategy-parameter-change");
  const result = analyzeChangeImpact(changeSet);
  const removed = result.invalidatedEvidence[0];
  result.invalidatedEvidence = result.invalidatedEvidence.slice(1);
  result.retainedEvidence = [...result.retainedEvidence, removed];
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("must be invalidated")));
});

test("the verifier catches a fingerprint that was silently kept alive", () => {
  const changeSet = loadFixture("strategy-parameter-change");
  const result = analyzeChangeImpact(changeSet);
  result.invalidatedFingerprints = result.invalidatedFingerprints.filter((f) => f !== "STRATEGY");
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("fingerprint STRATEGY must be invalidated")));
});

test("the verifier catches a dropped revalidation stage", () => {
  const changeSet = loadFixture("persistence-change");
  const result = analyzeChangeImpact(changeSet);
  result.requiredStages = result.requiredStages.filter((stage) => stage !== "OFFLINE_SAFETY_PREFLIGHT");
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("OFFLINE_SAFETY_PREFLIGHT")));
});

test("the verifier catches an approval list that does not match policy", () => {
  const changeSet = loadFixture("strategy-parameter-change");
  const result = analyzeChangeImpact(changeSet);
  result.requiredApprovals = ["MAINTAINER"];
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("required approvals do not match policy")));
});

test("the verifier catches an evidence type listed as both invalidated and retained", () => {
  const changeSet = loadFixture("installer-change");
  const result = analyzeChangeImpact(changeSet);
  result.retainedEvidence = [...result.retainedEvidence, result.invalidatedEvidence[0]];
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("both invalidated and retained")));
});

test("the verifier catches a suppressed test-weakening warning", () => {
  const changeSet = loadFixture("test-assertion-removal");
  const result = analyzeChangeImpact(changeSet);
  result.warnings = result.warnings.filter((w) => !w.startsWith("TEST_WEAKENING"));
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("no TEST_WEAKENING warning")));
});

test("the verifier rejects a permitted same-version binary replacement", () => {
  const changeSet = loadFixture("installer-change");
  const result = analyzeChangeImpact(changeSet);
  result.releasePolicy = { ...result.releasePolicy, sameVersionBinaryReplacementAllowed: true };
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("same-version binary replacement")));
});

test("the verifier rejects a runtime change that skips the new-release-ID requirement", () => {
  const changeSet = loadFixture("installer-change");
  const result = analyzeChangeImpact(changeSet);
  result.releasePolicy = { ...result.releasePolicy, newReleaseIdRequired: false };
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("new release ID")));
});

test("the verifier catches an altered risk level via the result hash", () => {
  const changeSet = loadFixture("persistence-change");
  const result = analyzeChangeImpact(changeSet);
  result.riskLevel = "LEVEL_3";
  result.categories = [...result.categories];
  result.changeDecision = "APPROVED_FOR_IMPLEMENTATION";
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("resultSha256")));
});

test("the verifier catches a tampered changeSetSha256", () => {
  const changeSet = loadFixture("docs-only");
  const result = analyzeChangeImpact(changeSet);
  result.hashes = { ...result.hashes, changeSetSha256: "0".repeat(64) };
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("changeSetSha256")));
});

test("the verifier rejects an UNKNOWN category graded below LEVEL_4", () => {
  const changeSet = loadFixture("unknown-file");
  const result = analyzeChangeImpact(changeSet);
  result.riskLevel = "LEVEL_1";
  result.riskLevelNumber = 1;
  const verification = verifyChangeControlResult(changeSet, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((m) => m.includes("UNKNOWN category")));
});
