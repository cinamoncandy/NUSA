const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository,
  OrderOperationalRestrictionReason,
  PositionReconciliationStatus,
  ScriptedSyntheticPositionProvider,
  releasePositionMismatchRestriction,
  runPositionReconciliationWorker
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) {
    if (this.records.has(result.reconciliationId)) throw new Error("duplicate reconciliation");
    this.records.set(result.reconciliationId, result);
  }
  getById(id) { return this.records.get(id); }
}

function position(walletId, symbol, baseQtyRaw, avgEntryPriceRaw = 100n) {
  return {
    scopeType: contracts.PositionScopeType.WALLET,
    walletId,
    symbol,
    baseQtyRaw,
    quoteCostRaw: baseQtyRaw * avgEntryPriceRaw,
    avgEntryPriceRaw: baseQtyRaw === 0n ? undefined : avgEntryPriceRaw,
    realizedPnlRaw: 0n,
    status: baseQtyRaw === 0n ? contracts.PositionStatus.CLOSED : contracts.PositionStatus.OPEN,
    version: 1
  };
}

const policy = { maxPositionsPerRun: 2, baseQtyToleranceRaw: 0n, avgEntryPriceToleranceRaw: 0n };

test("worker processes positions in deterministic bounded order", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const positions = { list: () => [position("b", "ETHUSDT", 1n), position("a", "ETHUSDT", 1n), position("a", "BTCUSDT", 1n)] };
  const provider = new ScriptedSyntheticPositionProvider([
    { accountId: "a", symbol: "BTCUSDT", baseQtyRaw: 1n, avgEntryPriceRaw: 100n, observedAtMs: 1000 },
    { accountId: "a", symbol: "ETHUSDT", baseQtyRaw: 1n, avgEntryPriceRaw: 100n, observedAtMs: 1000 }
  ]);
  const result = runPositionReconciliationWorker({ runId: "run-1", positions, provider, policy, restrictions, evidence, nowMs: 1000 });
  assert.equal(result.scannedCount, 2);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.results.map(item => `${item.accountId}:${item.symbol}`), ["a:BTCUSDT", "a:ETHUSDT"]);
});

test("provider unavailable for an open position activates uncertainty restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = runPositionReconciliationWorker({
    runId: "run-2",
    positions: { list: () => [position("account-1", "BTCUSDT", 2n)] },
    provider: new ScriptedSyntheticPositionProvider([]),
    policy,
    restrictions,
    evidence,
    nowMs: 1000
  });
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.restrictionCount, 1);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, OrderOperationalRestrictionReason.POSITION_STATE_UNCERTAIN);
});

test("provider unavailable for a closed position does not invent exposure risk", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const result = runPositionReconciliationWorker({
    runId: "run-3",
    positions: { list: () => [position("account-1", "BTCUSDT", 0n)] },
    provider: new ScriptedSyntheticPositionProvider([]),
    policy,
    restrictions,
    evidence: new Evidence(),
    nowMs: 1000
  });
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.restrictionCount, 0);
  assert.equal(restrictions.getActiveForAccount("account-1"), undefined);
});

test("uncertain position restriction requires a later matched reconciliation to release", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  runPositionReconciliationWorker({
    runId: "run-4",
    positions: { list: () => [position("account-1", "BTCUSDT", 2n)] },
    provider: new ScriptedSyntheticPositionProvider([]),
    policy,
    restrictions,
    evidence,
    nowMs: 1000
  });
  const active = restrictions.getActiveForAccount("account-1");
  const matched = runPositionReconciliationWorker({
    runId: "run-5",
    positions: { list: () => [position("account-1", "BTCUSDT", 2n)] },
    provider: new ScriptedSyntheticPositionProvider([{ accountId: "account-1", symbol: "BTCUSDT", baseQtyRaw: 2n, avgEntryPriceRaw: 100n, observedAtMs: 2000 }]),
    policy,
    restrictions,
    evidence,
    nowMs: 2000
  }).results[0];
  assert.equal(matched.status, PositionReconciliationStatus.MATCHED);
  const released = releasePositionMismatchRestriction({
    releaseId: "release-1",
    restrictionId: active.restrictionId,
    matchedReconciliationId: matched.reconciliationId,
    requestedBy: "operator-a",
    verifiedBy: "operator-b",
    rationale: "Provider position is available and matches the local snapshot.",
    nowMs: 2100,
    restrictions,
    reconciliations: evidence,
    releaseEvidence: new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository()
  });
  assert.equal(released.status, "RELEASED");
});
