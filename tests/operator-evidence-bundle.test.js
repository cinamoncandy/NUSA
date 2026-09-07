const test = require("node:test");
const assert = require("node:assert/strict");
const { appendPaperScenarioEvent } = require("../dist/apps/cloud/src/paperScenarioEvidenceLedger.js");
const { exportOperatorEvidenceBundle, verifyOperatorEvidenceBundle } = require("../dist/apps/cloud/src/operatorEvidenceBundle.js");
const { createResearchRunManifest } = require("../dist/apps/cloud/src/researchRunValidation.js");

const now = Date.UTC(2026, 6, 15);
const event = (eventId, type, extra = {}) => ({ eventId, type, occurredAt: now, sessionId: "session-1", ...extra });
const reader = () => {
  let events = [];
  for (const item of [
    event("session", "SESSION_OBSERVED"),
    event("order", "ORDER_COMPLETED"),
    event("regime", "REGIME_OBSERVED", { scenario: "UP_TREND" }),
    event("recovery", "RECOVERY_COMPLETED"),
    event("duplicate", "DUPLICATE_ORDER_CHECKED")
  ]) events = appendPaperScenarioEvent(events.map((record) => record), item);
  return { loadScenarioEvents: () => events.map((record) => record.event) };
};
const manifest = createResearchRunManifest({
  runId: "wf", runType: "WALK_FORWARD", strategyId: "strategy", strategyVersion: "1",
  parameterSet: { fast: 5 }, datasetId: "dataset", datasetChecksum: "a".repeat(64),
  datasetStart: "2026-01-01T00:00:00.000Z", datasetEnd: "2026-02-01T00:00:00.000Z",
  sampleCount: 2, createdAt: "2026-07-15T00:00:00.000Z", codeVersion: "sha",
  config: {}, result: {}
});

test("operator export is read-only and deterministic", () => {
  const input = {
    generatedAt: now, applicationVersion: "0.1.0", codeVersion: "sha",
    databaseIdentity: "db-hash", validationProfile: "SCENARIO_BASED",
    targetStrategy: { strategyId: "strategy", strategyVersion: "1" },
    targetDataset: { datasetId: "dataset", datasetChecksum: "a".repeat(64) },
    researchManifests: [manifest], researchReports: []
  };
  const first = exportOperatorEvidenceBundle(reader(), input);
  const second = exportOperatorEvidenceBundle(reader(), input);
  assert.deepEqual(first, second);
  assert.equal(first.releaseReadiness.status, "BLOCKED");
  assert.equal(first.derivedCounters.sessionCount, 1);
  assert.equal(first.derivedCounters.completedOrderCount, 1);
  assert.equal(first.events.length, 5);
  assert.ok(first.warnings.includes("RESEARCH_MONTE_CARLO_MISSING_OR_FAILED"));
  assert.equal(first.scenarioValidation.reasons.includes("MONTE_CARLO_NOT_PASSED"), true);
  verifyOperatorEvidenceBundle(first);
});

test("corrupt event reader fails closed without partial bundle", () => {
  assert.throws(() => exportOperatorEvidenceBundle({ loadScenarioEvents: () => [{ eventId: "x", type: "UNKNOWN", occurredAt: now }] }, {
    generatedAt: now, applicationVersion: "0.1.0", codeVersion: "sha", databaseIdentity: "db",
    validationProfile: "SCENARIO_BASED", targetStrategy: { strategyId: "s", strategyVersion: "1" },
    targetDataset: { datasetId: "d", datasetChecksum: "a".repeat(64) }, researchManifests: [], researchReports: []
  }));
});

test("tampered bundle checksum is rejected", () => {
  const bundle = exportOperatorEvidenceBundle(reader(), {
    generatedAt: now, applicationVersion: "0.1.0", codeVersion: "sha", databaseIdentity: "db",
    validationProfile: "SCENARIO_BASED", targetStrategy: { strategyId: "s", strategyVersion: "1" },
    targetDataset: { datasetId: "d", datasetChecksum: "a".repeat(64) }, researchManifests: [], researchReports: []
  });
  assert.throws(() => verifyOperatorEvidenceBundle({ ...bundle, warnings: ["tampered"] }));
});
