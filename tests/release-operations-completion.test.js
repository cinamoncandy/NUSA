const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOperatorRunbook } = require("../dist/apps/cloud/src/operatorRunbook.js");
const { buildRecoveryPlan } = require("../dist/apps/cloud/src/disasterRecovery.js");
const { buildVersionProvenance } = require("../dist/apps/cloud/src/versionProvenance.js");
const { buildStrategyLifecycleView } = require("../dist/apps/cloud/src/strategyLifecycleView.js");
const { buildChampionDashboard } = require("../dist/apps/cloud/src/championDashboard.js");
const { buildEvidenceBundle } = require("../dist/apps/cloud/src/evidenceBundle.js");
const { buildComplianceReport } = require("../dist/apps/cloud/src/complianceReport.js");
const { buildReleaseReadinessReport } = require("../dist/apps/cloud/src/releaseReadinessAudit.js");

const sha = "a".repeat(64);
const provenance = buildVersionProvenance({
  generatedAt: 100,
  gitSha: "abcdef1",
  datasetSha256: sha,
  runtimeVersion: "1.0.0",
  researchVersion: "1.0.0",
  committeeVersion: "1.0.0"
});

const readiness = buildReleaseReadinessReport({
  generatedAt: 100,
  ciGreen: true,
  typecheckPassed: true,
  buildPassed: true,
  testsPassed: true,
  runtimeAuditPassed: true,
  performanceAuditPassed: true,
  securityAuditPassed: true,
  recoveryProcedureDocumented: true,
  operatorRunbookDocumented: true,
  paperValidationDays: 30,
  unresolvedCriticalFindings: 0,
  unresolvedHighFindings: 0,
  liveTradingEnabled: false,
  pullRequestDraft: true
});

test("operator runbook is ordered and never auto-executes", () => {
  const runbook = buildOperatorRunbook("RUNTIME_FAILURE", "CRITICAL");
  assert.equal(runbook.steps.length, 5);
  assert.equal(runbook.steps[0].order, 1);
  assert.equal(runbook.automaticExecutionAllowed, false);
  assert.ok(Object.isFrozen(runbook));
});

test("recovery remains blocked until all evidence and approval exist", () => {
  const blocked = buildRecoveryPlan("SQLITE_CORRUPTION", { backupAvailable: true, integrityCheckPassed: false, replayAvailable: true, ownerApproved: false });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.paperResumeAllowed, false);
  const ready = buildRecoveryPlan("SQLITE_CORRUPTION", { backupAvailable: true, integrityCheckPassed: true, replayAvailable: true, ownerApproved: true });
  assert.equal(ready.status, "READY");
  assert.equal(ready.paperResumeAllowed, true);
});

test("provenance and lifecycle contracts validate deterministic state", () => {
  assert.equal(provenance.schemaVersion, 1);
  assert.throws(() => buildVersionProvenance({ ...provenance, datasetSha256: "bad" }), /datasetSha256/);
  const lifecycle = buildStrategyLifecycleView({ strategyId: "carry", stage: "PAPER", researchPassed: true, backtestPassed: true, walkForwardPassed: true, paperEligible: true, champion: false, archived: false });
  assert.equal(lifecycle.nextStage, "CHAMPION");
});

test("Champion dashboard is read-only and never auto-promotes", () => {
  const dashboard = buildChampionDashboard([
    { strategyId: "a", role: "CHAMPION", status: "HEALTHY", netPnl: 10, captureRatio: 0.8, maxDrawdownRatio: 0.1, paperDays: 40 },
    { strategyId: "b", role: "CHALLENGER", status: "HEALTHY", netPnl: 12, captureRatio: 0.9, maxDrawdownRatio: 0.08, paperDays: 35 }
  ]);
  assert.equal(dashboard.champion.strategyId, "a");
  assert.equal(dashboard.challengers[0].strategyId, "b");
  assert.equal(dashboard.promotionAllowed, false);
});

test("evidence bundle and compliance report fail closed when incomplete", () => {
  const completeNames = ["runtime", "health", "recorder", "replay", "incident", "snapshot", "audit", "paper-validation"];
  const complete = buildEvidenceBundle("bundle-1", 100, provenance, completeNames.map((name) => ({ name, generatedAt: 100, sha256: sha, payload: { ok: true } })));
  assert.equal(complete.complete, true);
  const report = buildComplianceReport("30 Day Paper", "PAPER", 100, readiness, complete);
  assert.equal(report.readinessStatus, "READY");
  assert.equal(report.automaticSubmissionAllowed, false);

  const incomplete = buildEvidenceBundle("bundle-2", 100, provenance, []);
  const blocked = buildComplianceReport("30 Day Paper", "PAPER", 100, readiness, incomplete);
  assert.equal(blocked.readinessStatus, "BLOCKED");
  assert.equal(blocked.evidenceComplete, false);
});
