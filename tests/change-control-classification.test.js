const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyzeChangeImpact, classifyPath } = require("../scripts/lib/change-impact-analyzer.js");

const fixturesDir = path.join(__dirname, "fixtures", "change-control");
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));
const analyzeFixture = (name) => analyzeChangeImpact(loadFixture(name));

test("a documentation-only change is LEVEL_0", () => {
  assert.equal(analyzeFixture("docs-only").riskLevel, "LEVEL_0");
});

test("a UI copy change is LEVEL_1", () => {
  assert.equal(analyzeFixture("ui-copy").riskLevel, "LEVEL_1");
});

test("an installer change is LEVEL_2", () => {
  assert.equal(analyzeFixture("installer-change").riskLevel, "LEVEL_2");
});

test("a persistence change is LEVEL_3", () => {
  assert.equal(analyzeFixture("persistence-change").riskLevel, "LEVEL_3");
});

test("a strategy parameter change is LEVEL_4", () => {
  assert.equal(analyzeFixture("strategy-parameter-change").riskLevel, "LEVEL_4");
});

test("adding a live-trading capability is LEVEL_5 and is rejected outright", () => {
  const result = analyzeFixture("live-capability-addition");
  assert.equal(result.riskLevel, "LEVEL_5");
  assert.equal(result.changeDecision, "REJECT_CHANGE");
  assert.ok(result.blockers.length > 0);
});

test("a LEVEL_5 change has no approval path at all", () => {
  const result = analyzeFixture("live-capability-addition");
  assert.deepEqual(result.requiredApprovals, []);
});

test("an unclassifiable file defaults to high risk, never low", () => {
  const result = analyzeFixture("unknown-file");
  assert.ok(result.categories.includes("UNKNOWN"));
  assert.equal(result.riskLevel, "LEVEL_4");
  assert.ok(result.warnings.some((w) => w.startsWith("UNKNOWN_FILE_CLASSIFICATION")));
});

test("a mixed change aggregates every category and the highest risk wins", () => {
  const result = analyzeFixture("mixed-high-risk-change");
  assert.ok(result.categories.includes("DOCUMENTATION_ONLY"));
  assert.ok(result.categories.includes("UI_LAYOUT"));
  assert.ok(result.categories.includes("PAPER_BROKER"));
  assert.equal(result.riskLevel, "LEVEL_4");
});

test("a strategy parameter edit hidden inside a stylesheet is still LEVEL_4, not a UI change", () => {
  const changeSet = {
    schemaVersion: 1, changeId: "CR-SNEAK", baselineCommitSha: "a", targetCommitSha: "b",
    changeRequest: { changeId: "CR-SNEAK", title: "t", reason: "r", requestedBy: "u", rollbackPlan: "revert" },
    changedFiles: [{ path: "apps/desktop/renderer/theme.css", status: "MODIFIED", addedLines: ["  shortWindow: 9,"], removedLines: ["  shortWindow: 5,"] }]
  };
  const result = analyzeChangeImpact(changeSet);
  assert.equal(result.riskLevel, "LEVEL_4");
  assert.ok(result.categories.includes("STRATEGY_PARAMETER"));
});

test("a risk-limit relaxation hidden inside an unremarkable file is still LEVEL_4", () => {
  const result = analyzeFixture("risk-limit-increase");
  assert.equal(result.riskLevel, "LEVEL_4");
  assert.ok(result.warnings.some((w) => w.startsWith("RISK_RELAXATION")));
});

test("tightening a risk limit is still a change requiring revalidation, but is not flagged as a relaxation", () => {
  const result = analyzeFixture("risk-limit-tightening");
  assert.equal(result.riskLevel, "LEVEL_4");
  assert.ok(!result.warnings.some((w) => w.startsWith("RISK_RELAXATION")));
  assert.ok(result.invalidatedFingerprints.includes("RISK_POLICY"));
});

test("path classification maps representative paths to their expected categories", () => {
  assert.equal(classifyPath("docs/a.md"), "DOCUMENTATION_ONLY");
  assert.equal(classifyPath("tests/a.test.js"), "TEST_ONLY");
  assert.equal(classifyPath(".github/workflows/ci.yml"), "BUILD_PIPELINE");
  assert.equal(classifyPath("package.json"), "DEPENDENCY");
  assert.equal(classifyPath("apps/desktop/src/paperBroker.ts"), "PAPER_BROKER");
  assert.equal(classifyPath("apps/desktop/src/strategyEngine.ts"), "STRATEGY");
  assert.equal(classifyPath("nothing/we/know.xyz"), "UNKNOWN");
});

test("a change set with no change request is rejected as INVALID", () => {
  const changeSet = {
    schemaVersion: 1, changeId: "CR-NOCR", baselineCommitSha: "a", targetCommitSha: "b",
    changedFiles: [{ path: "docs/a.md", status: "MODIFIED", addedLines: [], removedLines: [] }]
  };
  const result = analyzeChangeImpact(changeSet);
  assert.equal(result.status, "FAIL");
  assert.equal(result.changeDecision, "INVALID");
  assert.ok(result.blockers.some((b) => b.includes("changeRequest")));
});

test("an emergency hotfix still requires a change request", () => {
  const changeSet = {
    schemaVersion: 1, changeId: "CR-URGENT", baselineCommitSha: "a", targetCommitSha: "b",
    changedFiles: [{ path: "apps/desktop/src/desktopSqlite.ts", status: "MODIFIED", addedLines: ["fix"], removedLines: [] }]
  };
  const result = analyzeChangeImpact(changeSet);
  assert.equal(result.status, "FAIL");
  assert.ok(result.blockers.some((b) => b.includes("including an emergency hotfix")));
});

test("an emergency change that did not evaluate rollback first is warned about", () => {
  const result = analyzeFixture("emergency-hotfix-without-rollback");
  assert.equal(result.emergency, true);
  assert.ok(result.warnings.some((w) => w.startsWith("EMERGENCY_WITHOUT_ROLLBACK_EVALUATION")));
});
