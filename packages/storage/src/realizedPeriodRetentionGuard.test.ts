import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteDatabase } from "./index";
import {
  PersistedPaperPeriodStoreError,
  SqlitePersistedPaperPeriodStore,
  type RealizedPeriodRetentionGuard,
} from "./persistedPaperPeriodStore";

// v2 Impact Analysis M1 / A7. Retention is the one place realized Lane B evidence is physically
// deleted, and lineage replay resolves evidence by exact `paper-period:<recordId>`. A guard-less
// prune deletes on recency alone, so a recorded cycle's basis can vanish while its receipt survives.
// These tests pin the guard contract: it is mandatory, it protects cited periods, and it never
// silently pretends the bound held.

const guardOf = (...recordIds: string[]): RealizedPeriodRetentionGuard => ({ referencedRecordIds: () => new Set(recordIds) });

/**
 * Raw rows rather than decoded envelopes: retention reads only identity and chronology, and a
 * fixture that cannot be decoded proves the guard cannot be bypassed by a payload it never opens.
 * Retained ids are therefore read straight from the table, not through `listRecords()`.
 */
function storeWithPeriods(count: number): { store: SqlitePersistedPaperPeriodStore; ids: () => string[]; close: () => void } {
  const db = new SqliteDatabase(":memory:");
  const store = new SqlitePersistedPaperPeriodStore(db);
  const insert = db.connection.prepare("INSERT INTO research_paper_forward_periods (record_id, period_index, period_start_at, period_end_at, payload_json, checksum) VALUES (?, ?, ?, ?, '{}', 'x')");
  for (let index = 0; index < count; index += 1) insert.run(`record-${index}`, index, 1_000 + index, 1_001 + index);
  const ids = (): string[] => (db.connection.prepare("SELECT record_id FROM research_paper_forward_periods ORDER BY record_id ASC").all() as Array<{ record_id: string }>).map((row) => row.record_id);
  return { store, ids, close: () => db.close() };
}

const retainedIds = (store: SqlitePersistedPaperPeriodStore, ids: () => string[], bound: number, guard: RealizedPeriodRetentionGuard): string[] => {
  store.prune(bound, guard);
  return ids();
};

test("a cited period survives retention while unreferenced periods are pruned", () => {
  const { store, ids, close } = storeWithPeriods(6);
  try {
    // Bound 3 keeps record-3..5; record-0 is cited and must survive anyway.
    const result = store.prune(3, guardOf("record-0"));
    assert.equal(result.deleted, 2, "record-1 and record-2 are past the bound and cited by nobody");
    assert.deepEqual([...result.protectedRecordIds], ["record-0"]);
    assert.equal(result.boundReached, false, "the bound did not hold, and the report must say so");
    assert.deepEqual(retainedIds(store, ids, 3, guardOf("record-0")), ["record-0", "record-3", "record-4", "record-5"]);
  } finally {
    close();
  }
});

test("retention without a guard is refused rather than silently recency-only", () => {
  const { store, ids, close } = storeWithPeriods(2);
  try {
    assert.throws(() => (store as unknown as { prune(n: number): void }).prune(1), (error: unknown) => error instanceof PersistedPaperPeriodStoreError && error.code === "MISSING_RETENTION_GUARD");
    assert.throws(() => store.prune(1, undefined as unknown as RealizedPeriodRetentionGuard), (error: unknown) => error instanceof PersistedPaperPeriodStoreError && error.code === "MISSING_RETENTION_GUARD");
    assert.deepEqual(ids(), ["record-0", "record-1"], "a refused retention deletes nothing");
  } finally {
    close();
  }
});

test("an out-of-range bound is rejected before any guard is consulted", () => {
  const { store, close } = storeWithPeriods(2);
  try {
    for (const bound of [0, -1, 1_001, 1.5]) {
      assert.throws(() => store.prune(bound, guardOf()), (error: unknown) => error instanceof PersistedPaperPeriodStoreError && error.code === "INVALID_RETENTION");
    }
  } finally {
    close();
  }
});

test("the retention bound is never relaxed to clear a protected period", () => {
  const { store, ids, close } = storeWithPeriods(5);
  try {
    // Every period is cited. Only three of them sit past the bound, so only three are protected;
    // the rest are simply within it. Retention may delete nothing, and must still report the
    // owner-set bound unchanged rather than inventing a smaller one that would "succeed".
    const result = store.prune(2, guardOf("record-0", "record-1", "record-2", "record-3", "record-4"));
    assert.equal(result.bound, 2);
    assert.equal(result.deleted, 0);
    assert.deepEqual([...result.protectedRecordIds], ["record-0", "record-1", "record-2"]);
    assert.equal(ids().length, 5, "evidence integrity outranks the bound, and is visible");
  } finally {
    close();
  }
});

test("a citation of an already-absent period is reported unverifiable, never re-derived", () => {
  const { store, ids, close } = storeWithPeriods(2);
  try {
    const result = store.prune(10, guardOf("record-0", "ghost-period"));
    assert.deepEqual([...result.danglingReferences], ["ghost-period"]);
    assert.equal(result.protectedRecordIds.length, 0);
    assert.equal(ids().length, 2, "the missing basis is never invented to satisfy the citation");
  } finally {
    close();
  }
});

test("the guard is resolved at each retention, so a later citation still protects", () => {
  const { store, ids, close } = storeWithPeriods(4);
  try {
    store.prune(2, guardOf());
    assert.deepEqual(ids(), ["record-2", "record-3"]);
    // A citation appended after the previous retention must still be honoured on the next one.
    assert.deepEqual(retainedIds(store, ids, 2, guardOf("record-2")), ["record-2", "record-3"]);
  } finally {
    close();
  }
});

test("an empty citation set keeps the historical retention behaviour exactly", () => {
  const { store, ids, close } = storeWithPeriods(5);
  try {
    const result = store.prune(3, guardOf());
    assert.equal(result.deleted, 2);
    assert.equal(result.boundReached, true);
    assert.deepEqual([...result.protectedRecordIds], []);
    assert.deepEqual([...result.danglingReferences], []);
    assert.deepEqual(ids(), ["record-2", "record-3", "record-4"]);
  } finally {
    close();
  }
});
