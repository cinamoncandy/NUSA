const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyzeChangeImpact } = require("../scripts/lib/change-impact-analyzer.js");
const matrix = require("../scripts/lib/evidence-invalidation-matrix.js");

const fixturesDir = path.join(__dirname, "fixtures", "change-control");
const analyzeFixture = (name) => analyzeChangeImpact(JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8")));

test("a documentation-only change invalidates no evidence at all", () => {
  const result = analyzeFixture("docs-only");
  assert.deepEqual(result.invalidatedEvidence, []);
  assert.deepEqual(result.invalidatedFingerprints, []);
});

test("a strategy change invalidates every research evidence type", () => {
  const result = analyzeFixture("strategy-parameter-change");
  for (const evidence of ["DATASET_INTEGRITY", "BACKTEST", "COST_STRESS", "WALK_FORWARD", "PARAMETER_ROBUSTNESS", "REGIME_ANALYSIS", "CROSS_MARKET", "STRATEGY_SCORECARD"]) {
    assert.ok(result.invalidatedEvidence.includes(evidence), `${evidence} should be invalidated`);
  }
});

test("a strategy change invalidates every Paper pilot evidence type", () => {
  const result = analyzeFixture("strategy-parameter-change");
  for (const evidence of ["SHADOW_PILOT", "CANARY_PILOT", "EXTENDED_PAPER"]) {
    assert.ok(result.invalidatedEvidence.includes(evidence), `${evidence} should be invalidated`);
  }
});

test("an accounting change invalidates research AND ledger-dependent Paper evidence", () => {
  const result = analyzeFixture("accounting-change");
  for (const evidence of ["BACKTEST", "WALK_FORWARD", "SAFETY_DRILLS", "SHADOW_PILOT", "CANARY_PILOT", "EXTENDED_PAPER"]) {
    assert.ok(result.invalidatedEvidence.includes(evidence), `${evidence} should be invalidated`);
  }
});

test("an installer change invalidates packaging evidence but retains research evidence", () => {
  const result = analyzeFixture("installer-change");
  for (const evidence of ["INSTALLER", "UPGRADE", "ROLLBACK", "ARTIFACT_INTEGRITY", "WINDOWS_GUI"]) {
    assert.ok(result.invalidatedEvidence.includes(evidence), `${evidence} should be invalidated`);
  }
  for (const evidence of ["BACKTEST", "WALK_FORWARD", "PARAMETER_ROBUSTNESS"]) {
    assert.ok(result.retainedEvidence.includes(evidence), `${evidence} should be retained`);
  }
});

test("a persistence change invalidates upgrade and rollback evidence", () => {
  const result = analyzeFixture("persistence-change");
  assert.ok(result.invalidatedEvidence.includes("UPGRADE"));
  assert.ok(result.invalidatedEvidence.includes("ROLLBACK"));
  assert.ok(result.invalidatedEvidence.includes("SAFETY_DRILLS"));
});

test("a LEVEL_5 change invalidates every evidence type without exception", () => {
  const result = analyzeFixture("live-capability-addition");
  assert.equal(result.invalidatedEvidence.length, matrix.EVIDENCE_TYPES.length);
  assert.deepEqual(result.retainedEvidence, []);
});

test("invalidated and retained evidence always partition the vocabulary exactly", () => {
  for (const name of fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"))) {
    const result = analyzeChangeImpact(JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8")));
    if (result.status !== "PASS") continue;
    const combined = [...result.invalidatedEvidence, ...result.retainedEvidence].sort();
    assert.deepEqual(combined, [...matrix.EVIDENCE_TYPES].sort(), `${name} does not partition the evidence vocabulary`);
  }
});

test("a strategy change invalidates the strategy fingerprint", () => {
  assert.ok(analyzeFixture("strategy-parameter-change").invalidatedFingerprints.includes("STRATEGY"));
});

test("a risk-limit change invalidates the config and risk-policy fingerprints", () => {
  const result = analyzeFixture("risk-limit-increase");
  assert.ok(result.invalidatedFingerprints.includes("CONFIG"));
  assert.ok(result.invalidatedFingerprints.includes("RISK_POLICY"));
});

test("any shipped change invalidates the runtime fingerprint, but docs and tests do not", () => {
  assert.ok(analyzeFixture("installer-change").invalidatedFingerprints.includes("RUNTIME"));
  assert.ok(!analyzeFixture("docs-only").invalidatedFingerprints.includes("RUNTIME"));
});

test("any invalidated fingerprint invalidates bound approvals", () => {
  assert.equal(analyzeFixture("strategy-parameter-change").approvalInvalidated, true);
  assert.equal(analyzeFixture("docs-only").approvalInvalidated, false);
});

test("a runtime change requires a new release ID and never a same-version binary swap", () => {
  const result = analyzeFixture("installer-change");
  assert.equal(result.releasePolicy.newReleaseIdRequired, true);
  assert.equal(result.releasePolicy.sameVersionBinaryReplacementAllowed, false);
  assert.equal(result.releasePolicy.artifactImmutable, true);
});

test("the evidence availability disclosure marks not-yet-implemented evidence honestly", () => {
  const result = analyzeFixture("strategy-parameter-change");
  assert.equal(result.evidenceAvailability.WALK_FORWARD, "PRODUCIBLE");
  assert.equal(result.evidenceAvailability.REGIME_ANALYSIS, "PRODUCIBLE");
  assert.equal(result.evidenceAvailability.SHADOW_PILOT, "NOT_PRODUCED");
  assert.equal(result.evidenceAvailability.EXTENDED_PAPER, "NOT_PRODUCED");
});

test("every declared change category has an evidence, fingerprint, stage, and risk entry", () => {
  for (const category of matrix.CHANGE_CATEGORIES) {
    assert.ok(matrix.CATEGORY_INVALIDATES[category] !== undefined, `${category} missing evidence mapping`);
    assert.ok(matrix.CATEGORY_INVALIDATES_FINGERPRINTS[category] !== undefined, `${category} missing fingerprint mapping`);
    assert.ok(matrix.CATEGORY_REQUIRED_STAGES[category] !== undefined, `${category} missing stage mapping`);
    assert.ok(matrix.CATEGORY_RISK_LEVEL[category] !== undefined, `${category} missing risk level`);
  }
});

test("every evidence type has an availability disclosure", () => {
  for (const evidence of matrix.EVIDENCE_TYPES) {
    assert.ok(["PRODUCIBLE", "NOT_PRODUCED"].includes(matrix.EVIDENCE_AVAILABILITY[evidence]), `${evidence} missing availability`);
  }
});
