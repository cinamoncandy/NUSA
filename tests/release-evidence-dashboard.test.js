const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { appendPaperScenarioEvent } = require("../dist/apps/cloud/src/paperScenarioEvidenceLedger.js");
const { exportOperatorEvidenceBundle } = require("../dist/apps/cloud/src/operatorEvidenceBundle.js");
const { buildReleaseEvidenceDashboard } = require("../dist/apps/cloud/src/releaseEvidenceDashboard.js");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

const at = Date.UTC(2026, 6, 15);
const bundle = () => {
  let records = [];
  for (const event of [
    { eventId: "session", type: "SESSION_OBSERVED", occurredAt: at, sessionId: "s" },
    { eventId: "regime", type: "REGIME_OBSERVED", occurredAt: at, sessionId: "s", scenario: "RANGE" }
  ]) records = appendPaperScenarioEvent(records, event);
  return exportOperatorEvidenceBundle({ loadScenarioEvents: () => records.map((record) => record.event) }, {
    generatedAt: at, applicationVersion: "0.1.0", codeVersion: "sha", databaseIdentity: "db",
    validationProfile: "SCENARIO_BASED", targetStrategy: { strategyId: "s", strategyVersion: "1" },
    targetDataset: { datasetId: "d", datasetChecksum: "a".repeat(64) }, researchManifests: [], researchReports: []
  });
};

test("dashboard derives counts and remains blocked for unverified legacy provenance", () => {
  const dashboard = buildReleaseEvidenceDashboard(bundle(), at);
  assert.equal(dashboard.releaseStatus, "BLOCKED");
  assert.equal(dashboard.requirements.observedSessions.status, "NOT_EVALUATED");
  assert.ok(dashboard.blockingReasons.some((reason) => reason.includes("ownerReview")));
  assert.equal(dashboard.ownerReview.status, "MISSING");
});

test("owner review records are append-only and checksum verified", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-review-"));
  const store = new DesktopPersistenceStore(join(directory, "paper.sqlite"));
  const b = bundle();
  const reviewedAt = "2026-07-15T00:00:00.000Z";
  const base = { reviewId: "review-1", bundleChecksum: b.bundleChecksum, reviewerId: "owner", decision: "REQUEST_MORE_EVIDENCE", note: "blocked", reviewedAt };
  const recordChecksum = createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex");
  const record = { ...base, recordChecksum };
  store.appendOwnerReview(record, "BLOCKED");
  assert.deepEqual(store.loadOwnerReviews(), [record]);
  assert.throws(() => store.appendOwnerReview({ ...record, note: "changed" }, "BLOCKED"));
  assert.throws(() => store.appendOwnerReview({ ...record, reviewId: "review-2", decision: "APPROVE" }, "BLOCKED"));
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
