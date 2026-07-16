const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  PositionReconciliationStatus,
  ScriptedSyntheticPositionProvider,
  reconcilePosition,
  releasePositionMismatchRestriction,
  releaseOrderOperationalRestriction,
  InMemoryOrderExecutionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) {
    if (this.records.has(result.reconciliationId)) throw new Error("duplicate reconciliation");
    this.records.set(result.reconciliationId, result);
  }
  getById(id) { return this.records.get(id); }
}

function local(baseQtyRaw = 2n, avgEntryPriceRaw = 100n) {
  return {
    scopeType: contracts.PositionScopeType.WALLET,
    walletId: "account-1",
    symbol: "BTCUSDT",
    baseQtyRaw,
    quoteCostRaw: baseQtyRaw * avgEntryPriceRaw,
    avgEntryPriceRaw,
    realizedPnlRaw: 0n,
    status: baseQtyRaw === 0n ? contracts.PositionStatus.CLOSED : contracts.PositionStatus.OPEN,
    version: 1
  };
}

const policy = { baseQtyToleranceRaw: 0n, avgEntryPriceToleranceRaw: 0n };

test("matching provider position records evidence without restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcilePosition({
    reconciliationId: "recon-1", restrictionId: "restriction-1", accountId: "account-1",
    local: local(), provider: new ScriptedSyntheticPositionProvider([{ accountId: "account-1", symbol: "BTCUSDT", baseQtyRaw: 2n, avgEntryPriceRaw: 100n, observedAtMs: 1000 }]),
    policy, restrictions, evidence, nowMs: 1000
  });
  assert.equal(result.status, PositionReconciliationStatus.MATCHED);
  assert.equal(restrictions.getActiveForAccount("account-1"), undefined);
  assert.equal(evidence.getById("recon-1").status, PositionReconciliationStatus.MATCHED);
});

test("quantity mismatch activates account new-exposure restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcilePosition({
    reconciliationId: "recon-2", restrictionId: "restriction-2", accountId: "account-1",
    local: local(), provider: new ScriptedSyntheticPositionProvider([{ accountId: "account-1", symbol: "BTCUSDT", baseQtyRaw: 1n, avgEntryPriceRaw: 100n, observedAtMs: 1000 }]),
    policy, restrictions, evidence, nowMs: 1000
  });
  assert.equal(result.status, PositionReconciliationStatus.MISMATCH);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, "POSITION_MISMATCH");
  assert.equal(restrictions.getActiveForAccount("account-1").blockNewExposure, true);
});

test("provider absence preserves uncertainty without inventing a match", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcilePosition({
    reconciliationId: "recon-3", restrictionId: "restriction-3", accountId: "account-1",
    local: local(), provider: new ScriptedSyntheticPositionProvider([]), policy, restrictions, evidence, nowMs: 1000
  });
  assert.equal(result.status, PositionReconciliationStatus.PROVIDER_UNAVAILABLE);
  assert.equal(restrictions.getActiveForAccount("account-1"), undefined);
});

test("generic restriction release cannot release a position mismatch", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save({ restrictionId: "restriction-4", accountId: "account-1", reason: "POSITION_MISMATCH", sourceRunId: "recon-4", sourceIntentIds: [], blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: 1000 });
  assert.throws(() => releaseOrderOperationalRestriction({
    releaseId: "release-4", restrictionId: "restriction-4", requestedBy: "operator-a", verifiedBy: "operator-b", rationale: "looks fine", nowMs: 2000,
    restrictions, executions: new InMemoryOrderExecutionRepository(), evidence: new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository()
  }), /matched position reconciliation evidence/);
});

test("position mismatch release requires a later matched reconciliation and separated verification", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const reconciliations = new Evidence();
  const releaseEvidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  restrictions.save({ restrictionId: "restriction-5", accountId: "account-1", reason: "POSITION_MISMATCH", sourceRunId: "recon-mismatch", sourceIntentIds: [], blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: 1000 });
  reconciliations.append({ reconciliationId: "recon-match", accountId: "account-1", symbol: "BTCUSDT", status: PositionReconciliationStatus.MATCHED, localBaseQtyRaw: 2n, providerBaseQtyRaw: 2n, baseQtyDifferenceRaw: 0n, localAvgEntryPriceRaw: 100n, providerAvgEntryPriceRaw: 100n, avgEntryPriceDifferenceRaw: 0n, observedAtMs: 1500 });

  const released = releasePositionMismatchRestriction({
    releaseId: "release-5", restrictionId: "restriction-5", matchedReconciliationId: "recon-match",
    requestedBy: "operator-a", verifiedBy: "operator-b", rationale: "position verified against provider", nowMs: 1600,
    restrictions, reconciliations, releaseEvidence
  });

  assert.equal(released.status, "RELEASED");
  const evidence = releaseEvidence.getByRestrictionId("restriction-5");
  assert.match(evidence.rationale, /matchedReconciliationId=recon-match/);
  assert.deepEqual(evidence.verifiedIntentIds, []);
});

test("position mismatch release rejects stale, mismatched, or unavailable reconciliation evidence", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const reconciliations = new Evidence();
  const releaseEvidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  restrictions.save({ restrictionId: "restriction-6", accountId: "account-1", reason: "POSITION_MISMATCH", sourceRunId: "recon-source", sourceIntentIds: [], blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: 1000 });
  reconciliations.append({ reconciliationId: "recon-old", accountId: "account-1", symbol: "BTCUSDT", status: PositionReconciliationStatus.MATCHED, localBaseQtyRaw: 2n, observedAtMs: 900 });
  reconciliations.append({ reconciliationId: "recon-unavailable", accountId: "account-1", symbol: "BTCUSDT", status: PositionReconciliationStatus.PROVIDER_UNAVAILABLE, localBaseQtyRaw: 2n, observedAtMs: 1500 });
  reconciliations.append({ reconciliationId: "recon-other-account", accountId: "account-2", symbol: "BTCUSDT", status: PositionReconciliationStatus.MATCHED, localBaseQtyRaw: 2n, observedAtMs: 1500 });

  const base = { releaseId: "release-6", restrictionId: "restriction-6", requestedBy: "operator-a", verifiedBy: "operator-b", rationale: "verified", nowMs: 1600, restrictions, reconciliations, releaseEvidence };
  assert.throws(() => releasePositionMismatchRestriction({ ...base, matchedReconciliationId: "recon-old" }), /predates restriction/);
  assert.throws(() => releasePositionMismatchRestriction({ ...base, matchedReconciliationId: "recon-unavailable" }), /is not matched/);
  assert.throws(() => releasePositionMismatchRestriction({ ...base, matchedReconciliationId: "recon-other-account" }), /account mismatch/);
  assert.equal(restrictions.getById("restriction-6").status, "ACTIVE");
});
