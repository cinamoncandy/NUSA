const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  PositionReconciliationStatus,
  ScriptedSyntheticPositionProvider,
  reconcilePosition,
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
