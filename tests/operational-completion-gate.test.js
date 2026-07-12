const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateOperationalCompletion } = require("../dist/apps/cloud/src/operationalCompletionGate.js");

const generatedAt = 10_000;
const section = (overrides = {}) => ({ status: "HEALTHY", availability: "AVAILABLE", generatedAt, reasons: [], ...overrides });
const dashboard = (overrides = {}) => ({
  generatedAt,
  status: "HEALTHY",
  tradingPermitted: false,
  portfolio: section(),
  opportunities: section(),
  strategies: section(),
  committee: section(),
  execution: section(),
  research: section(),
  risk: section(),
  warnings: [],
  ...overrides
});
const paperEvidence = (overrides = {}) => ({
  generatedAt,
  status: "PASS",
  firstObservedAt: 1,
  lastObservedAt: generatedAt,
  calendarDays: 30,
  observedDays: 30,
  totalRuns: 100,
  availabilityRatio: 1,
  failureRatio: 0,
  snapshotFailureRatio: 0,
  incidents: 0,
  criticalIncidents: 0,
  integrityFailures: 0,
  qualifyingDays: 30,
  reasons: [],
  releaseReadinessPaperValidationDays: 30,
  ...overrides
});
const scenarios = ["SQLITE_CORRUPTION", "SNAPSHOT_CORRUPTION", "RUNTIME_CRASH", "EVENT_LOG_GAP"];
const recoveryPlans = () => scenarios.map((scenario) => ({ scenario, status: "READY", steps: [], blockers: [], paperResumeAllowed: true }));
const releaseReadiness = (paperPassed = true, overrides = {}) => {
  const requirements = [
    { id: "CI", title: "CI", required: true, passed: true, reason: "" },
    { id: "TYPECHECK", title: "Typecheck", required: true, passed: true, reason: "" },
    { id: "PAPER_VALIDATION", title: "Paper", required: true, passed: paperPassed, reason: "" }
  ];
  return {
    generatedAt,
    status: paperPassed ? "READY" : "BLOCKED",
    score: paperPassed ? 100 : 67,
    minimumPaperValidationDays: 30,
    requirements,
    blockers: paperPassed ? [] : ["Paper"],
    warnings: [],
    automaticReleaseAllowed: false,
    ...overrides
  };
};
const input = (overrides = {}) => ({
  now: generatedAt,
  dashboard: dashboard(),
  paperEvidence: paperEvidence(),
  recoveryPlans: recoveryPlans(),
  releaseReadiness: releaseReadiness(),
  ...overrides
});

test("returns owner-review readiness only when every evidence family passes", () => {
  const result = evaluateOperationalCompletion(input());
  assert.equal(result.status, "READY_FOR_OWNER_REVIEW");
  assert.equal(result.sourceCoverageComplete, true);
  assert.equal(result.paperEvidenceComplete, true);
  assert.equal(result.recoveryDrillsComplete, true);
  assert.equal(result.releaseAuditComplete, true);
  assert.equal(result.ownerReviewRequired, true);
  assert.equal(result.automaticCompletionAllowed, false);
  assert.equal(result.liveTradingAllowed, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
});

test("elapsed Paper evidence remains waiting and is never fabricated as completion", () => {
  const result = evaluateOperationalCompletion(input({
    paperEvidence: paperEvidence({ status: "FAIL", calendarDays: 2, observedDays: 2, releaseReadinessPaperValidationDays: 0 }),
    releaseReadiness: releaseReadiness(false)
  }));
  assert.equal(result.status, "WAITING_FOR_EVIDENCE");
  assert.deepEqual(result.pendingEvidence, ["PAPER_VALIDATION_EVIDENCE_INCOMPLETE", "RELEASE_PAPER_VALIDATION_INCOMPLETE"]);
  assert.equal(result.automaticCompletionAllowed, false);
});

test("missing dashboard sources and blocked recovery fail closed", () => {
  const plans = recoveryPlans();
  plans[0] = { ...plans[0], status: "BLOCKED", paperResumeAllowed: false };
  const result = evaluateOperationalCompletion(input({
    dashboard: dashboard({ committee: section({ availability: "UNAVAILABLE" }), status: "BLOCKED" }),
    recoveryPlans: plans
  }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("DASHBOARD_SOURCE_COMMITTEE_NOT_AVAILABLE"));
  assert.ok(result.blockers.includes("DASHBOARD_STATUS_BLOCKED"));
  assert.ok(result.blockers.includes("RECOVERY_SCENARIO_SQLITE_CORRUPTION_BLOCKED"));
});

test("non-Paper release failures block while missing Paper duration only waits", () => {
  const report = releaseReadiness(true);
  report.status = "BLOCKED";
  report.requirements[0] = { ...report.requirements[0], passed: false };
  const result = evaluateOperationalCompletion(input({ releaseReadiness: report }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("RELEASE_REQUIREMENT_CI_FAILED"));
});

test("duplicate recovery scenarios and future evidence are rejected deterministically", () => {
  const duplicate = [...recoveryPlans(), recoveryPlans()[0]];
  assert.throws(() => evaluateOperationalCompletion(input({ recoveryPlans: duplicate })), /duplicate recovery scenario/);
  assert.throws(() => evaluateOperationalCompletion(input({ dashboard: dashboard({ generatedAt: generatedAt + 1 }) })), /future/);
  assert.deepEqual(evaluateOperationalCompletion(input()), evaluateOperationalCompletion(input()));
});
