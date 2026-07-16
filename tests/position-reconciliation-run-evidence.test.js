const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const runStorage = require("../dist/packages/storage/src/position-reconciliation-run-evidence.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  PositionReconciliationFreshnessStatus,
  PositionReconciliationStatus,
  ScriptedSyntheticPositionProvider,
  evaluatePositionReconciliationFreshness,
  runPositionReconciliationWorker
} = execution;
const { SqliteDatabase } = storage;
const { SqlitePositionReconciliationRunEvidenceRepository } = runStorage;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) { this.records.set(result.reconciliationId, result); }
  getById(id) { return this.records.get(id); }
}

function position() {
  return {
    scopeType: contracts.PositionScopeType.WALLET,
    walletId: "account-1",
    symbol: "BTCUSDT",
    baseQtyRaw: 1n,
    quoteCostRaw: 100n,
    avgEntryPriceRaw: 100n,
    realizedPnlRaw: 0n,
    status: contracts.PositionStatus.OPEN,
    version: 1
  };
}

test("SQLite stores reconciliation run summary as append-only evidence", () => {
  const db = new SqliteDatabase(":memory:");
  const runEvidence = new SqlitePositionReconciliationRunEvidenceRepository(db);
  const result = runPositionReconciliationWorker({
    runId: "run-1",
    positions: { list: () => [position()] },
    provider: new ScriptedSyntheticPositionProvider([{ accountId: "account-1", symbol: "BTCUSDT", baseQtyRaw: 1n, avgEntryPriceRaw: 100n, observedAtMs: 1000 }]),
    policy: { maxPositionsPerRun: 10, baseQtyToleranceRaw: 0n, avgEntryPriceToleranceRaw: 0n },
    restrictions: new InMemoryOrderOperationalRestrictionRepository(),
    evidence: new Evidence(),
    runEvidence,
    nowMs: 1000
  });
  const stored = runEvidence.getById("run-1");
  assert.equal(stored.matchedCount, 1);
  assert.deepEqual(stored.reconciliationIds, result.results.map(item => item.reconciliationId));
  assert.throws(() => runEvidence.append(stored));
  db.close();
});

test("matched reconciliation becomes expiring and then stale", () => {
  const result = {
    reconciliationId: "recon-1",
    accountId: "account-1",
    symbol: "BTCUSDT",
    status: PositionReconciliationStatus.MATCHED,
    localBaseQtyRaw: 1n,
    providerBaseQtyRaw: 1n,
    baseQtyDifferenceRaw: 0n,
    observedAtMs: 1000
  };
  assert.equal(evaluatePositionReconciliationFreshness({ result, nowMs: 1499, warningAgeMs: 500, maximumAgeMs: 1000 }), PositionReconciliationFreshnessStatus.FRESH);
  assert.equal(evaluatePositionReconciliationFreshness({ result, nowMs: 1500, warningAgeMs: 500, maximumAgeMs: 1000 }), PositionReconciliationFreshnessStatus.EXPIRING_SOON);
  assert.equal(evaluatePositionReconciliationFreshness({ result, nowMs: 2000, warningAgeMs: 500, maximumAgeMs: 1000 }), PositionReconciliationFreshnessStatus.STALE);
});

test("mismatch and unavailable results are never treated as fresh matches", () => {
  for (const status of [PositionReconciliationStatus.MISMATCH, PositionReconciliationStatus.PROVIDER_UNAVAILABLE]) {
    const result = { reconciliationId: `recon-${status}`, accountId: "account-1", symbol: "BTCUSDT", status, localBaseQtyRaw: 1n, observedAtMs: 1000 };
    assert.equal(evaluatePositionReconciliationFreshness({ result, nowMs: 1100, warningAgeMs: 500, maximumAgeMs: 1000 }), PositionReconciliationFreshnessStatus.NOT_MATCHED);
  }
});
