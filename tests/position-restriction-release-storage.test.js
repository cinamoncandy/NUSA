const test = require("node:test");
const assert = require("node:assert/strict");

const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const restrictionStorage = require("../dist/packages/storage/src/order-restriction.js");
const releaseEvidenceStorage = require("../dist/packages/storage/src/order-restriction-release-evidence.js");
const positionEvidenceStorage = require("../dist/packages/storage/src/position-reconciliation.js");

const { releasePositionMismatchRestriction } = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderOperationalRestrictionRepository } = restrictionStorage;
const { SqliteOrderOperationalRestrictionReleaseEvidenceRepository } = releaseEvidenceStorage;
const { SqlitePositionReconciliationEvidenceRepository } = positionEvidenceStorage;

function activeRestriction() {
  return {
    restrictionId: "position-restriction-1",
    accountId: "account-1",
    reason: "POSITION_MISMATCH",
    sourceRunId: "position-recon-mismatch",
    sourceIntentIds: [],
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "ACTIVE",
    createdAtMs: 1000
  };
}

function matchedResult() {
  return {
    reconciliationId: "position-recon-match",
    accountId: "account-1",
    symbol: "BTCUSDT",
    status: "MATCHED",
    localBaseQtyRaw: 2n,
    providerBaseQtyRaw: 2n,
    baseQtyDifferenceRaw: 0n,
    localAvgEntryPriceRaw: 100n,
    providerAvgEntryPriceRaw: 100n,
    avgEntryPriceDifferenceRaw: 0n,
    observedAtMs: 2000
  };
}

test("SQLite position restriction release persists matched reconciliation identity", () => {
  const db = new SqliteDatabase(":memory:");
  const restrictions = new SqliteOrderOperationalRestrictionRepository(db);
  const reconciliations = new SqlitePositionReconciliationEvidenceRepository(db);
  const releaseEvidence = new SqliteOrderOperationalRestrictionReleaseEvidenceRepository(db);
  restrictions.save(activeRestriction());
  reconciliations.append(matchedResult());

  releasePositionMismatchRestriction({
    releaseId: "position-release-1",
    restrictionId: "position-restriction-1",
    matchedReconciliationId: "position-recon-match",
    requestedBy: "operator-a",
    verifiedBy: "operator-b",
    rationale: "Provider and local positions were rechecked and matched.",
    nowMs: 3000,
    restrictions,
    reconciliations,
    releaseEvidence,
    transaction: db
  });

  const stored = releaseEvidence.getByRestrictionId("position-restriction-1");
  assert.equal(stored.matchedReconciliationId, "position-recon-match");
  assert.equal(stored.rationale, "Provider and local positions were rechecked and matched.");
  assert.equal(restrictions.getById("position-restriction-1").status, "RELEASED");
  db.close();
});

test("SQLite transaction preserves active restriction if position release evidence insert fails", () => {
  const db = new SqliteDatabase(":memory:");
  const restrictions = new SqliteOrderOperationalRestrictionRepository(db);
  const reconciliations = new SqlitePositionReconciliationEvidenceRepository(db);
  const releaseEvidence = new SqliteOrderOperationalRestrictionReleaseEvidenceRepository(db);
  restrictions.save(activeRestriction());
  reconciliations.append(matchedResult());
  releaseEvidence.append({
    releaseId: "existing-release",
    restrictionId: "position-restriction-1",
    accountId: "account-1",
    requestedBy: "operator-x",
    verifiedBy: "operator-y",
    rationale: "existing evidence",
    verifiedIntentIds: [],
    matchedReconciliationId: "position-recon-match",
    releasedAtMs: 2500
  });

  assert.throws(() => releasePositionMismatchRestriction({
    releaseId: "position-release-2",
    restrictionId: "position-restriction-1",
    matchedReconciliationId: "position-recon-match",
    requestedBy: "operator-a",
    verifiedBy: "operator-b",
    rationale: "second release attempt",
    nowMs: 3000,
    restrictions,
    reconciliations,
    releaseEvidence,
    transaction: db
  }));
  assert.equal(restrictions.getById("position-restriction-1").status, "ACTIVE");
  db.close();
});
