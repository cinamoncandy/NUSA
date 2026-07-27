const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyzeChangeImpact } = require("../scripts/lib/change-impact-analyzer.js");
const matrix = require("../scripts/lib/evidence-invalidation-matrix.js");

const fixturesDir = path.join(__dirname, "fixtures", "change-control");
const analyzeFixture = (name) => analyzeChangeImpact(JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8")));

test("a documentation-only change needs only the minimum unit check", () => {
  assert.deepEqual(analyzeFixture("docs-only").requiredStages, ["UNIT_ONLY"]);
});

test("a UI change requires CI, package smoke, real Windows GUI acceptance, and a new RC", () => {
  const stages = analyzeFixture("ui-copy").requiredStages;
  for (const stage of ["FULL_CI", "PACKAGE_SMOKE", "WINDOWS_GUI_ACCEPTANCE", "NEW_RELEASE_CANDIDATE"]) {
    assert.ok(stages.includes(stage), `${stage} should be required`);
  }
});

test("a persistence change requires the safety preflight and limited Paper revalidation", () => {
  const stages = analyzeFixture("persistence-change").requiredStages;
  for (const stage of ["FULL_CI", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]) {
    assert.ok(stages.includes(stage), `${stage} should be required`);
  }
});

test("a strategy change requires the full research pipeline and restarts from Shadow", () => {
  const stages = analyzeFixture("strategy-parameter-change").requiredStages;
  for (const stage of ["FULL_RESEARCH_PIPELINE", "SHADOW", "CANARY_PAPER", "EXTENDED_PAPER", "NEW_RELEASE_CANDIDATE"]) {
    assert.ok(stages.includes(stage), `${stage} should be required`);
  }
});

test("an accounting change requires the full research pipeline and Paper revalidation", () => {
  const stages = analyzeFixture("accounting-change").requiredStages;
  for (const stage of ["FULL_RESEARCH_PIPELINE", "OFFLINE_SAFETY_PREFLIGHT", "MANUAL_PAPER", "CANARY_PAPER", "EXTENDED_PAPER"]) {
    assert.ok(stages.includes(stage), `${stage} should be required`);
  }
});

test("UNIT_ONLY is dropped once any broader stage is required", () => {
  const stages = analyzeFixture("strategy-parameter-change").requiredStages;
  assert.ok(!stages.includes("UNIT_ONLY"));
  assert.ok(stages.includes("FULL_CI"));
});

test("required stages are always reported in canonical execution order", () => {
  for (const name of fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"))) {
    const result = analyzeChangeImpact(JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8")));
    if (result.status !== "PASS") continue;
    const indices = result.requiredStages.map((stage) => matrix.PAPER_STAGES.indexOf(stage));
    const sorted = [...indices].sort((a, b) => a - b);
    assert.deepEqual(indices, sorted, `${name} stages are not in canonical order`);
  }
});

test("a mixed change takes the union of every category's required stages", () => {
  const stages = analyzeFixture("mixed-high-risk-change").requiredStages;
  assert.ok(stages.includes("WINDOWS_GUI_ACCEPTANCE"), "UI part requires GUI acceptance");
  assert.ok(stages.includes("FULL_RESEARCH_PIPELINE"), "accounting part requires the research pipeline");
});

test("a LEVEL_5 change has no revalidation plan because it is not approvable", () => {
  const result = analyzeFixture("live-capability-addition");
  assert.deepEqual(result.requiredStages, []);
  assert.equal(result.changeDecision, "REJECT_CHANGE");
});

test("approval level escalates with risk level and LEVEL_4 demands a full revalidation plan", () => {
  assert.deepEqual(analyzeFixture("docs-only").requiredApprovals, ["MAINTAINER"]);
  assert.ok(analyzeFixture("ui-copy").requiredApprovals.includes("TEST_RESULTS"));
  assert.ok(analyzeFixture("installer-change").requiredApprovals.includes("RELEASE_OWNER"));
  assert.ok(analyzeFixture("persistence-change").requiredApprovals.includes("SAFETY_REVIEWER"));
  assert.ok(analyzeFixture("strategy-parameter-change").requiredApprovals.includes("FULL_REVALIDATION_PLAN"));
});

test("a dependency change is at least LEVEL_2 and requires an offline safety preflight", () => {
  const result = analyzeFixture("dependency-change");
  assert.ok(result.riskLevelNumber >= 2);
  assert.ok(result.requiredStages.includes("OFFLINE_SAFETY_PREFLIGHT"));
  assert.ok(result.invalidatedEvidence.includes("SAFETY_DRILLS"));
});

test("a test-weakening change is escalated above a plain test-only change", () => {
  const result = analyzeFixture("test-assertion-removal");
  assert.ok(result.riskLevelNumber >= 2);
  assert.ok(result.warnings.some((w) => w.startsWith("TEST_WEAKENING")));
});
