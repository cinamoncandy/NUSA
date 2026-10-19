const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { SqliteDatabase, SqlitePersistedPaperPeriodStore, PersistedPaperPeriodStoreError } = require("../dist/packages/storage/src/index.js");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const pending = (periodIndex, periodStartAt, periodId = `period-${periodIndex}`, observations = []) => {
  const payloadJson = JSON.stringify({ schemaVersion: 1, periodId, periodIndex, periodStartAt, observations, observationIds: [] });
  return { periodId, periodIndex, periodStartAt, payloadJson, checksum: hash(payloadJson) };
};

test("retired disposition successor cannot be resurrected with the reserved identity and altered evidence", () => {
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

    assert.deepEqual(store.listPending(), []);
    assert.equal(store.listPendingDispositions().length, 1);
    assert.equal(store.nextPeriodIndex(), 23);
  } finally {
    db.close();
  }
});
