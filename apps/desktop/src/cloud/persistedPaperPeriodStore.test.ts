import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../../packages/storage/src/index";
import { adaptPersistedPaperPeriods, type PersistedPaperPeriodRecord } from "./persistedPaperPeriodAdapter";
import { PersistedPaperPeriodStoreError, SqlitePersistedPaperPeriodStore, type PersistedPaperPeriodEnvelope } from "./persistedPaperPeriodStore";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function advisory(generatedAt: string): LeagueCapitalAllocationAdvisory {
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 0.6, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 5, maximumFamilyWeight: 0.6 },
    entries: ["a", "b"].map((id, index) => ({ id, familyId: "family-1", rank: index + 1, leagueScore: 100 - index, evidenceBreadth: 1, researchWeight: 0.5, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: [`dataset-${id}`] })),
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a", "dataset-b"] },
  };
}

function record(index = 0, id = `record-${index}`): PersistedPaperPeriodRecord {
  const start = BASE + index * DAY;
  return { recordId: id, periodIndex: index, advisory: advisory(new Date(start - DAY).toISOString()), periodStartAt: start, periodEndAt: start + DAY, realizedReturns: { a: 0.01, b: -0.02 }, benchmarkReturn: 0.005, turnoverCostRate: 0.001, costEvidence: { evidenceId: `cost-${id}`, source: "PAPER_EXECUTION_RECEIPT", observedAt: start + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" };
}

function envelope(index = 0, id?: string): PersistedPaperPeriodEnvelope {
  return {
    record: record(index, id ?? `record-${index}`),
    candidateProvenance: [
      { candidateId: "a", datasetId: "dataset-a", datasetContentSha256: HASH_A },
      { candidateId: "b", datasetId: "dataset-b", datasetContentSha256: HASH_B },
    ],
  };
}

describe("SqlitePersistedPaperPeriodStore", () => {
  it("persists multiple provenance-bound periods and feeds #877 adapter after restart", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const first = new SqlitePersistedPaperPeriodStore(db);
      first.append(envelope(1));
      first.append(envelope(0));
      const restarted = new SqlitePersistedPaperPeriodStore(db);
      const stored = restarted.list();
      assert.deepEqual(stored.map((item) => item.record.periodIndex), [0, 1]);
      assert.equal(stored[0]!.candidateProvenance[0]!.datasetContentSha256, HASH_A);
      const adapted = adaptPersistedPaperPeriods(restarted.listRecords());
      assert.deepEqual(adapted.appliedRecordIds, ["record-0", "record-1"]);
      assert.equal(adapted.periods.length, 2);
    } finally { db.close(); }
  });

  it("is idempotent for an identical replay but rejects recordId mutation", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const store = new SqlitePersistedPaperPeriodStore(db);
      const original = envelope(0, "stable");
      store.append(original);
      store.append(original);
      assert.equal(store.list().length, 1);
      const mutated = { ...original, record: { ...original.record, benchmarkReturn: 0.9 } };
      assert.throws(() => store.append(mutated), (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "RECORD_ID_CONFLICT");
    } finally { db.close(); }
  });

  it("fails closed when advisory candidates lack exact dataset provenance", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const store = new SqlitePersistedPaperPeriodStore(db);
      assert.throws(() => store.append({ ...envelope(), candidateProvenance: [{ candidateId: "a", datasetId: "dataset-a", datasetContentSha256: HASH_A }] }), (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "MISSING_CANDIDATE_PROVENANCE");
      assert.throws(() => store.append({ ...envelope(), candidateProvenance: [...envelope().candidateProvenance, { candidateId: "ghost", datasetId: "dataset-ghost", datasetContentSha256: "c".repeat(64) }] }), (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "UNKNOWN_CANDIDATE_PROVENANCE");
    } finally { db.close(); }
  });

  it("rejects duplicate period indexes so replay cannot create two histories for one period", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const store = new SqlitePersistedPaperPeriodStore(db);
      store.append(envelope(0, "first"));
      assert.throws(() => store.append(envelope(0, "second")), (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "PERIOD_INDEX_CONFLICT");
    } finally { db.close(); }
  });
});
