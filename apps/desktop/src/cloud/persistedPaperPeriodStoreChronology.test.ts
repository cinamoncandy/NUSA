import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "../../../../packages/storage/src/index";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import { PersistedPaperPeriodStoreError, SqlitePersistedPaperPeriodStore, type PersistedPaperPeriodEnvelope } from "./persistedPaperPeriodStore";

const START = Date.parse("2026-08-10T00:00:00.000Z");
const HASH = "a".repeat(64);

function advisory(generatedAt: string): LeagueCapitalAllocationAdvisory {
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
    entries: [{ id: "a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }],
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a"] },
  };
}

function envelope(generatedAt: string): PersistedPaperPeriodEnvelope {
  return {
    record: {
      recordId: "period-0",
      periodIndex: 0,
      advisory: advisory(generatedAt),
      periodStartAt: START,
      periodEndAt: START + 86_400_000,
      realizedReturns: { a: 0.01 },
      benchmarkReturn: 0,
      turnoverCostRate: 0,
    },
    candidateProvenance: [{ candidateId: "a", datasetId: "dataset-a", datasetContentSha256: HASH }],
  };
}

test("PAPER persistence rejects an advisory created at the realized period start", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqlitePersistedPaperPeriodStore(db);
    assert.throws(
      () => store.append(envelope(new Date(START).toISOString())),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "LOOKAHEAD_ADVISORY_SNAPSHOT",
    );
    assert.equal(store.list().length, 0);
  } finally {
    db.close();
  }
});

test("PAPER persistence rejects malformed advisory time before writing", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqlitePersistedPaperPeriodStore(db);
    assert.throws(
      () => store.append(envelope("not-a-timestamp")),
      (error) => error instanceof PersistedPaperPeriodStoreError && error.code === "INVALID_ADVISORY_TIMESTAMP",
    );
    assert.equal(store.list().length, 0);
  } finally {
    db.close();
  }
});
