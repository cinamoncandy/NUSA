const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchRunManifest } = require("../dist/apps/cloud/src/researchRunValidation.js");
const { buildPersistedResearchDashboardSection } = require("../dist/apps/desktop/src/cloud/researchDashboardProjection.js");

const checkedAt = "2026-07-16T00:00:00.000Z";
const now = Date.parse(checkedAt);
const manifest = (runId, runType) => createResearchRunManifest({
  runId, runType, strategyId: "sma", strategyVersion: "1.0.0", parameterSet: { fast: 5, slow: 20 },
  datasetId: "dataset", datasetChecksum: "a".repeat(64), datasetStart: "2026-01-01T00:00:00.000Z",
  datasetEnd: "2026-02-01T00:00:00.000Z", sampleCount: 100, createdAt: checkedAt, codeVersion: "test",
  config: {}, result: { runId, runType }
});
const report = (entry, status = "PASS", reasons = []) => Object.freeze({
  runId: entry.runId, runType: entry.runType, status, reasons, checkedAt, resultChecksum: entry.resultChecksum
});
const input = (reports = [], manifests = []) => ({ generatedAt: now, reports, manifests });

test("shows no persisted research as explicitly unavailable", () => {
  const result = buildPersistedResearchDashboardSection(input());
  assert.equal(result.availability, "UNAVAILABLE");
  assert.deepEqual(result.reasons, ["NO_PERSISTED_RESEARCH_VALIDATION"]);
  assert.equal(result.paperPromotionEligible, false);
});

test("derives an available healthy research section from four matched persisted reports", () => {
  const manifests = [manifest("wf", "WALK_FORWARD"), manifest("stress", "COST_STRESS"), manifest("mc", "MONTE_CARLO"), manifest("integrity", "INTEGRITY_CHECK")];
  const result = buildPersistedResearchDashboardSection(input(manifests.map((entry) => report(entry)), manifests));
  assert.equal(result.availability, "AVAILABLE");
  assert.equal(result.status, "HEALTHY");
  assert.equal(result.paperPromotionEligible, true);
  assert.equal(result.walkForwardPassed, true);
  assert.equal(result.costStressPassed, true);
  assert.equal(result.monteCarloPassed, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("failed source evidence remains visible but blocks the research gate", () => {
  const manifests = [manifest("wf", "WALK_FORWARD"), manifest("stress", "COST_STRESS"), manifest("mc", "MONTE_CARLO"), manifest("integrity", "INTEGRITY_CHECK")];
  const reports = [report(manifests[0]), report(manifests[1], "FAIL", ["HIGH_COST"]), report(manifests[2]), report(manifests[3])];
  const result = buildPersistedResearchDashboardSection(input(reports, manifests));
  assert.equal(result.availability, "AVAILABLE");
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.paperPromotionEligible, false);
  assert.ok(result.reasons.includes("RESEARCH_COST_STRESS_HIGH_COST"));
});

test("manifest/report mismatches, duplicate report types, and future provenance fail closed", () => {
  const wf = manifest("wf", "WALK_FORWARD");
  assert.throws(() => buildPersistedResearchDashboardSection(input([report(wf)], [])), /does not match/);
  assert.throws(() => buildPersistedResearchDashboardSection(input([report(wf), report(wf)], [wf])), /duplicate/);
  assert.throws(() => buildPersistedResearchDashboardSection(input([{ ...report(wf), checkedAt: "2027-01-01T00:00:00.000Z" }], [wf])), /provenance/);
});
