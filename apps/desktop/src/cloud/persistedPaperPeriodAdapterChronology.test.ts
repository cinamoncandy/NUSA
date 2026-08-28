import assert from "node:assert/strict";
import test from "node:test";
import { adaptPersistedPaperPeriods, PersistedPaperPeriodAdapterError, type PersistedPaperPeriodRecord } from "./persistedPaperPeriodAdapter";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");
const HASH = "a".repeat(64);

function advisory(generatedAt: string): LeagueCapitalAllocationAdvisory {
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
    entries: [{ id: "a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }],
    excludedCandidateIds: [], reasons: ["NO_EXECUTION_AUTHORITY"], provenance: { sourceDatasetIds: ["dataset-a"] },
  };
}

function period(recordId: string, periodIndex: number, start: number, end: number): PersistedPaperPeriodRecord {
  return { recordId, periodIndex, advisory: advisory(new Date(start - DAY).toISOString()), periodStartAt: start, periodEndAt: end, realizedReturns: { a: 0.01 }, benchmarkReturn: 0, turnoverCostRate: 0.001, costEvidence: { evidenceId: `cost-${recordId}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: HASH, observedAt: start + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" };
}

test("PAPER adapter rejects wall-clock overlap even when period indexes increase", () => {
  assert.throws(
    () => adaptPersistedPaperPeriods([period("p0", 0, BASE, BASE + DAY), period("p1", 1, BASE + DAY / 2, BASE + DAY * 1.5)]),
    (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "NON_MONOTONIC_PERIOD_CHRONOLOGY" && error.recordId === "p1",
  );
});

test("PAPER adapter preserves the replayed period as chronology anchor", () => {
  assert.throws(
    () => adaptPersistedPaperPeriods(
      [period("p0", 0, BASE, BASE + DAY), period("p1", 1, BASE + DAY / 2, BASE + DAY * 1.5)],
      new Set(["p0"]),
    ),
    (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "NON_MONOTONIC_PERIOD_CHRONOLOGY" && error.recordId === "p1",
  );
});

test("PAPER adapter accepts contiguous non-overlapping wall-clock periods", () => {
  const result = adaptPersistedPaperPeriods([period("p0", 0, BASE, BASE + DAY), period("p1", 1, BASE + DAY, BASE + DAY * 2)]);
  assert.deepEqual(result.appliedRecordIds, ["p0", "p1"]);
});
