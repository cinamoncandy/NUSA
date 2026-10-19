const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { SqliteDatabase, SqlitePersistedPaperPeriodStore, PersistedPaperPeriodStoreError } = require("../dist/packages/storage/src/index.js");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const pending = (periodIndex, periodStartAt, periodId = `period-${periodIndex}`, observations = []) => {
  const payloadJson = JSON.stringify({ schemaVersion: 1, periodId, periodIndex, periodStartAt, observations, observationIds: [] });
  return { periodId, periodIndex, periodStartAt, payloadJson, checksum: hash(payloadJson) };
};
const realized = (recordId, periodIndex, periodStartAt) => ({
  record: {
    recordId,
    periodIndex,
    periodStartAt,
    periodEndAt: periodStartAt + 50,
    advisory: {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
      entries: [],
      excludedCandidateIds: [],
      reasons: [],
      provenance: { sourceDatasetIds: [] },
    },
    realizedReturns: {},
    benchmarkReturn: 0,
    turnoverCostRate: 0,
    status: "COMPLETED",
    costEvidence: {
      evidenceId: "isolated-test-cost",
      source: "PAPER_EXECUTION_RECEIPT",
      evidenceKind: "OBSERVED",
      evidenceFingerprintSha256: hash(`cost:${recordId}:${periodIndex}:${periodStartAt}`),
      observedAt: periodStartAt + 1,
      feeRate: 0,
      spreadRate: 0,
      slippageRate: 0,
    },
  },
  candidateProvenance: [],
});
const advisory = (candidateId) => ({
  schemaVersion: 1,
  generatedAt: new Date(0).toISOString(),
  policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
  entries: [{ id: candidateId }],
  excludedCandidateIds: [],
  reasons: [],
  provenance: { sourceDatasetIds: [] },
});

test("retired disposition successor cannot be resurrected as pending or realized evidence", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqlitePersistedPaperPeriodStore(db);
    const original = pending(21, 100);
    const successor = pending(22, 200);
    store.putPending(original);
    store.markPendingIneligible({
      original,
      successor,
      reason: {
        stage: "PERIOD_CLOSE",
        code: "INCOMPLETE_EXECUTION_COST_EVIDENCE",
        boundaryAt: 200,
        sourceRuntimeSha: null,
        blockedEvidenceFingerprintSha256: hash("isolated incomplete evidence"),
      },
    });

    store.putPending(successor); // exact active replay remains idempotent
    store.retirePending(successor.periodId, successor.checksum);

    const staleDifferentPayload = pending(22, 200, successor.periodId, [{ status: "STALE_REPLAY" }]);
    assert.throws(
      () => store.putPending(staleDifferentPayload),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PERIOD_INDEX_CONFLICT",
    );
    const staleDifferentStart = pending(22, 300, successor.periodId);
    assert.throws(
      () => store.putPending(staleDifferentStart),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PERIOD_INDEX_CONFLICT",
    );
    assert.throws(
      () => store.append(realized(successor.periodId, successor.periodIndex, 300)),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PENDING_TERMINAL",
    );
    assert.throws(
      () => store.append(realized("other-successor", successor.periodIndex, 300)),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PENDING_TERMINAL",
    );

    assert.deepEqual(store.listPending(), []);
    assert.deepEqual(store.list(), []);
    assert.equal(store.listPendingDispositions().length, 1);
    assert.equal(store.nextPeriodIndex(), 23);
  } finally {
    db.close();
  }
});

test("only finalizePending can realize an active disposition successor, and its envelope must match the plan", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqlitePersistedPaperPeriodStore(db);
    const original = pending(21, 100);
    const successor = pending(22, 200);
    const candidateProvenance = [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: hash("dataset-a") }];
    successor.payloadJson = JSON.stringify({ schemaVersion: 1, periodId: successor.periodId, periodIndex: successor.periodIndex, periodStartAt: successor.periodStartAt, market: "KRW-BTC", advisory: advisory("candidate-a"), candidateProvenance, observations: [], observationIds: [] });
    successor.checksum = hash(successor.payloadJson);
    store.putPending(original);
    store.markPendingIneligible({
      original,
      successor,
      reason: {
        stage: "PERIOD_CLOSE",
        code: "INCOMPLETE_EXECUTION_COST_EVIDENCE",
        boundaryAt: 200,
        sourceRuntimeSha: null,
        blockedEvidenceFingerprintSha256: hash("incomplete original"),
      },
    });

    const forged = {
      record: {
        ...realized(successor.periodId, successor.periodIndex, successor.periodStartAt).record,
        market: "KRW-BTC",
        advisory: advisory("candidate-b"),
        realizedReturns: { "candidate-b": 0.25 },
      },
      candidateProvenance: [{ candidateId: "candidate-b", datasetId: "dataset-b", datasetContentSha256: hash("dataset-b") }],
    };
    assert.throws(
      () => store.append(forged),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PENDING_TERMINAL",
    );
    assert.deepEqual(store.list(), []);
    assert.equal(store.listPending().length, 1);

    const valid = {
      record: {
        ...realized(successor.periodId, successor.periodIndex, successor.periodStartAt).record,
        market: "KRW-BTC",
        advisory: advisory("candidate-a"),
        realizedReturns: { "candidate-a": 0.01 },
      },
      candidateProvenance,
    };
    assert.deepEqual(store.finalizePending(successor.periodId, successor.checksum, valid), valid);
    assert.equal(store.list().length, 1);
    assert.deepEqual(store.listPending(), []);
    assert.equal(store.listPendingDispositions().length, 1);
  } finally {
    db.close();
  }
});
