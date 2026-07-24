const test = require("node:test");
const assert = require("node:assert/strict");
const { validateVersionedScenarioEvent } = require("../dist/apps/cloud/src/versionedScenarioEvidence.js");
const { evaluateAuthoritativeRelease } = require("../dist/apps/cloud/src/releaseEvidenceAuthority.js");

const target = {
  targetId: "target-1", validationProfile: "SCENARIO_BASED", strategyId: "s", strategyVersion: "1",
  parameterChecksum: "a".repeat(64), datasetId: "d", datasetChecksum: "b".repeat(64),
  codeVersion: "code", policyVersion: "policy", createdAt: "2026-07-15T00:00:00.000Z", targetChecksum: "c".repeat(64)
};

const bundle = {
  bundleVersion: 1, generatedAt: Date.UTC(2026, 6, 15), applicationVersion: "0.1.0", codeVersion: "code",
  databaseIdentity: "db", validationProfile: "SCENARIO_BASED", targetStrategy: { strategyId: "s", strategyVersion: "1" },
  targetDataset: { datasetId: "d", datasetChecksum: "b".repeat(64) }, events: [], eventChainHead: null,
  derivedCounters: { sessionCount: 0, completedOrderCount: 0, regimeCount: 0, recoveryPassCount: 0, duplicateOrderCheckCount: 0, passedFaultScenarios: [], firstOccurredAt: null, lastOccurredAt: null },
  representedRegimes: [], passedFaultScenarios: [], researchReports: [], scenarioValidation: { status: "FAIL" },
  releaseReadiness: { status: "BLOCKED" }, warnings: [], bundleChecksum: "d".repeat(64)
};
const dashboard = { bundleChecksum: bundle.bundleChecksum, releaseStatus: "BLOCKED" };

test("provenance is required and event-type constrained", () => {
  validateVersionedScenarioEvent({ schemaVersion: 1, eventId: "e", type: "SESSION_OBSERVED", occurredAt: 1, sessionId: "s", provenance: "LIVE_PAPER_RUNTIME" });
  assert.throws(() => validateVersionedScenarioEvent({ schemaVersion: 1, eventId: "e", type: "FAULT_SCENARIO_PASSED", occurredAt: 1, sessionId: "s", provenance: "LIVE_PAPER_RUNTIME" }));
  assert.throws(() => validateVersionedScenarioEvent({ schemaVersion: 1, eventId: "e", type: "FAULT_SCENARIO_PASSED", occurredAt: 1, sessionId: "s", provenance: "OPERATOR_FAULT_DRILL" }));
});

test("authoritative evaluator cannot approve from booleans or missing reports", () => {
  const result = evaluateAuthoritativeRelease({ target, bundle, dashboard, manifests: [], reports: [], reviews: [], evaluatedAt: "2026-07-15T00:00:00.000Z" });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("RESEARCH_VALIDATION_INCOMPLETE"));
  assert.ok(result.blockers.includes("OWNER_REVIEW_MISSING"));
});
