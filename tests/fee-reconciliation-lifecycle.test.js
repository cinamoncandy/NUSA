const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  FeeReconciliationStatus,
  FeeReconciliationFreshnessStatus,
  InMemoryOrderOperationalRestrictionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository,
  OrderOperationalRestrictionReason,
  evaluateFeeReconciliationFreshness,
  enforceFeeReconciliationFreshness,
  releaseFeeRestriction
} = execution;

class Evidence {
  constructor(records = []) { this.records = new Map(records.map(record => [record.reconciliationId, record])); }
  append(record) { this.records.set(record.reconciliationId, record); }
  getById(id) { return this.records.get(id); }
  getLatest(accountId) { return [...this.records.values()].filter(record => record.accountId === accountId).sort((a,b) => b.observedAtMs - a.observedAtMs || b.reconciliationId.localeCompare(a.reconciliationId))[0]; }
}
const matched = (id, observedAtMs) => ({ reconciliationId: id, accountId: "acct", status: FeeReconciliationStatus.MATCHED, localCount: 1, providerCount: 1, mismatchTradeIds: [], observedAtMs });

test("matched fee evidence transitions from fresh to stale", () => {
  const result = matched("m1", 100);
  const policy = { maxAgeMs: 100, expiringSoonAgeMs: 50 };
  assert.equal(evaluateFeeReconciliationFreshness(result, 120, policy), FeeReconciliationFreshnessStatus.FRESH);
  assert.equal(evaluateFeeReconciliationFreshness(result, 160, policy), FeeReconciliationFreshnessStatus.EXPIRING_SOON);
  assert.equal(evaluateFeeReconciliationFreshness(result, 201, policy), FeeReconciliationFreshnessStatus.STALE);
});

test("missing or non-matched evidence activates stale fee restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const restriction = enforceFeeReconciliationFreshness({ accountId: "acct", restrictionId: "fee-stale", nowMs: 500, policy: { maxAgeMs: 100, expiringSoonAgeMs: 50 }, evidence: new Evidence(), restrictions });
  assert.equal(restriction.reason, OrderOperationalRestrictionReason.FEE_RECONCILIATION_STALE);
  assert.equal(restriction.blockNewExposure, true);
});

test("fee restriction release requires later matched evidence and separated reviewers", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save({ restrictionId: "fee-r", accountId: "acct", reason: OrderOperationalRestrictionReason.FEE_RECONCILIATION_MISMATCH, sourceRunId: "bad", sourceIntentIds: [], blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: 100 });
  const feeEvidence = new Evidence([matched("good", 200)]);
  const releaseEvidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  assert.throws(() => releaseFeeRestriction({ releaseId: "release", restrictionId: "fee-r", matchedFeeReconciliationId: "good", requestedBy: "same", verifiedBy: "same", rationale: "checked", nowMs: 300, restrictions, feeEvidence, releaseEvidence }));
  const released = releaseFeeRestriction({ releaseId: "release", restrictionId: "fee-r", matchedFeeReconciliationId: "good", requestedBy: "alice", verifiedBy: "bob", rationale: "checked", nowMs: 300, restrictions, feeEvidence, releaseEvidence });
  assert.equal(released.status, "RELEASED");
  assert.equal(releaseEvidence.getByRestrictionId("fee-r").matchedFeeReconciliationId, "good");
});
