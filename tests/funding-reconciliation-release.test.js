const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  FundingReconciliationStatus,
  FundingReconciliationFreshnessStatus,
  InMemoryOrderOperationalRestrictionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository,
  evaluateFundingReconciliationFreshness,
  enforceFundingReconciliationFreshness,
  releaseFundingRestriction
} = execution;

function repository(...results) {
  const map = new Map(results.map(result => [result.reconciliationId, result]));
  return {
    append(result) { if (map.has(result.reconciliationId)) throw new Error("duplicate"); map.set(result.reconciliationId, result); },
    getById(id) { return map.get(id); },
    getLatest(accountId) { return [...map.values()].filter(value => value.accountId === accountId).sort((a, b) => b.observedAtMs - a.observedAtMs || b.reconciliationId.localeCompare(a.reconciliationId))[0]; }
  };
}

const matched = (id, observedAtMs) => ({ reconciliationId: id, accountId: "acct", status: FundingReconciliationStatus.MATCHED, localCount: 1, providerCount: 1, mismatchFundingIds: [], observedAtMs });

test("matched funding evidence becomes stale", () => {
  assert.equal(evaluateFundingReconciliationFreshness(matched("f1", 1000), 1500, { expiringSoonAgeMs: 200, maximumAgeMs: 400 }), FundingReconciliationFreshnessStatus.STALE);
});

test("stale funding evidence activates restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const created = enforceFundingReconciliationFreshness({ restrictionId: "r1", accountId: "acct", evidence: repository(matched("f1", 1000)), restrictions, policy: { expiringSoonAgeMs: 200, maximumAgeMs: 400 }, nowMs: 1500 });
  assert.equal(created.reason, "FUNDING_RECONCILIATION_STALE");
});

test("funding restriction release requires later match and separated reviewers", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save({ restrictionId: "r1", accountId: "acct", reason: "FUNDING_RECONCILIATION_STALE", sourceRunId: "old", sourceIntentIds: [], blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: 1000 });
  const evidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  const released = releaseFundingRestriction({ releaseId: "rel1", restrictionId: "r1", matchedFundingReconciliationId: "f2", requestedBy: "operator-a", verifiedBy: "operator-b", rationale: "later provider reconciliation matched", nowMs: 1300, restrictions, reconciliations: repository(matched("f2", 1200)), evidence });
  assert.equal(released.status, "RELEASED");
  assert.equal(evidence.getByRestrictionId("r1").matchedFundingReconciliationId, "f2");
});
