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

test("a new disposition cannot raw-insert a successor identity reserved by prior disposition history", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqlitePersistedPaperPeriodStore(db);
    const firstOriginal = pending(21, 100, "first-original");
    const retiredSuccessor = pending(22, 200, "reserved-successor");
    const reason = (boundaryAt) => ({
      stage: "PERIOD_CLOSE",
      code: "INCOMPLETE_EXECUTION_COST_EVIDENCE",
      boundaryAt,
      sourceRuntimeSha: null,
      blockedEvidenceFingerprintSha256: hash(`incomplete:${boundaryAt}`),
    });
    store.putPending(firstOriginal);
    store.markPendingIneligible({ original: firstOriginal, successor: retiredSuccessor, reason: reason(200) });
    store.retirePending(retiredSuccessor.periodId, retiredSuccessor.checksum);

    const nextOriginal = pending(23, 300, "next-original");
    store.putPending(nextOriginal);
    assert.throws(
      () => store.markPendingIneligible({ original: nextOriginal, successor: pending(24, 400, retiredSuccessor.periodId), reason: reason(400) }),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PERIOD_INDEX_CONFLICT",
      "raw successor insert must not reuse a prior reserved ID at another index",
    );

    assert.deepEqual(store.getPending(nextOriginal.periodId), nextOriginal, "failed attempts roll back the original transition");
    assert.equal(store.listPendingDispositions().length, 1);
    assert.deepEqual(store.listPending().map((item) => item.periodId), [nextOriginal.periodId]);
    store.markPendingIneligible({ original: nextOriginal, successor: pending(24, 400, "fresh-successor"), reason: reason(400) });
    assert.equal(store.listPendingDispositions().length, 2, "a fresh successor identity remains admissible");
    assert.equal(store.nextPeriodIndex(), 25);
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
    assert.deepEqual(store.append(valid), valid);
    assert.equal(store.list().length, 1);
    assert.deepEqual(store.listPending(), []);
    const conflictingReplay = { ...valid, record: { ...valid.record, realizedReturns: { "candidate-a": 0.02 } } };
    assert.throws(
      () => store.append(conflictingReplay),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "RECORD_ID_CONFLICT",
    );
    db.connection.prepare("UPDATE research_paper_forward_period_pending SET payload_json=? WHERE period_id=?").run(JSON.stringify({ schemaVersion: 2, kind: "INELIGIBLE_PENDING_PERIOD" }), original.periodId);
    assert.throws(
      () => store.append(valid),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "INVALID_PENDING_DISPOSITION",
    );
  } finally {
    db.close();
  }
});
