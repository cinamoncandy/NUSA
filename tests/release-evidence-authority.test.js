const test = require("node:test");
const assert = require("node:assert/strict");
const { validateVersionedScenarioEvent } = require("../dist/apps/cloud/src/versionedScenarioEvidence.js");
const { evaluateAuthoritativeRelease } = require("../dist/apps/cloud/src/releaseEvidenceAuthority.js");
const { createResearchRunManifest } = require("../dist/apps/cloud/src/researchRunValidation.js");

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

test("release authority blocks four passing copies of one gate even with a synthetic matching review", () => {
  const manifests = Array.from({ length: 4 }, (_, index) => createResearchRunManifest({
    runId: `duplicate-wf-${index}`, runType: "WALK_FORWARD", strategyId: target.strategyId,
    strategyVersion: target.strategyVersion, parameterSet: { fast: 5, slow: 20 },
    datasetId: target.datasetId, datasetChecksum: target.datasetChecksum,
    datasetStart: "2026-01-01T00:00:00.000Z", datasetEnd: "2026-02-01T00:00:00.000Z",
    sampleCount: 100, createdAt: target.createdAt, codeVersion: target.codeVersion, config: {}, result: {}
  }));
  const reports = manifests.map((manifest) => ({
    runId: manifest.runId, runType: manifest.runType, status: "PASS", reasons: [],
    checkedAt: target.createdAt, resultChecksum: manifest.resultChecksum
  }));
  const result = evaluateAuthoritativeRelease({
    target, bundle, dashboard: { ...dashboard, releaseStatus: "READY_FOR_OWNER_REVIEW" }, manifests, reports,
    reviews: [{ reviewId: "synthetic-review", bundleChecksum: bundle.bundleChecksum, decision: "APPROVE", reviewedAt: "2026-07-15T01:00:00.000Z" }],
    evaluatedAt: "2026-07-15T02:00:00.000Z"
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("RESEARCH_VALIDATION_INCOMPLETE"));
});
