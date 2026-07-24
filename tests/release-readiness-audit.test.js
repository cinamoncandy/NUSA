const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReleaseReadinessReport } = require("../dist/apps/cloud/src/releaseReadinessAudit.js");

const ready = (overrides = {}) => ({
  generatedAt: 1000,
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
  pullRequestDraft: true,
  ...overrides
});

test("returns READY only when all required and advisory checks pass", () => {
  const result = buildReleaseReadinessReport(ready());
  assert.equal(result.status, "READY");
  assert.equal(result.score, 100);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.automaticReleaseAllowed, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.requirements));
});

test("blocks release when paper validation is incomplete", () => {
  const result = buildReleaseReadinessReport(ready({ paperValidationDays: 29 }));
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join(" "), /Minimum Paper validation/);
});

test("blocks release when live trading is enabled", () => {
  const result = buildReleaseReadinessReport(ready({ liveTradingEnabled: true }));
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join(" "), /Live trading remains disabled/);
});

test("returns CONDITIONAL for advisory high findings", () => {
  const result = buildReleaseReadinessReport(ready({ unresolvedHighFindings: 1 }));
  assert.equal(result.status, "CONDITIONAL");
  assert.match(result.warnings.join(" "), /No unresolved high findings/);
});

test("validates counters and minimum duration", () => {
  assert.throws(() => buildReleaseReadinessReport(ready({ generatedAt: -1 })), /generatedAt/);
  assert.throws(() => buildReleaseReadinessReport(ready({ paperValidationDays: -1 })), /paperValidationDays/);
  assert.throws(() => buildReleaseReadinessReport(ready(), 0), /minimumPaperValidationDays/);
});

test("scenario profile replaces only the calendar Paper requirement", () => {
  const passed = buildReleaseReadinessReport(ready({
    paperValidationDays: 0,
    paperValidationProfile: "SCENARIO_BASED",
    scenarioPaperValidationPassed: true
  }));
  assert.equal(passed.status, "READY");
  assert.equal(passed.paperValidationProfile, "SCENARIO_BASED");
  assert.equal(passed.requirements.find((item) => item.id === "PAPER_VALIDATION").title, "Scenario Paper validation completed");

  const failed = buildReleaseReadinessReport(ready({
    paperValidationDays: 30,
    paperValidationProfile: "SCENARIO_BASED",
    scenarioPaperValidationPassed: false
  }));
  assert.equal(failed.status, "BLOCKED");
  assert.match(failed.blockers.join(" "), /Scenario Paper validation/);
});

test("invalid validation profile input is rejected", () => {
  assert.throws(() => buildReleaseReadinessReport(ready({ paperValidationProfile: "UNKNOWN" })), /unsupported/);
  assert.throws(() => buildReleaseReadinessReport(ready({ scenarioPaperValidationPassed: "yes" })), /boolean/);
});
