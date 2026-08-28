import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord } from "../../../../packages/contracts/src/persistedPaperPeriod";
import { adaptPersistedPaperForwardEvidence, PersistedPaperForwardEvidenceAdapterError } from "./persistedPaperForwardEvidenceAdapter";

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function advisory(generatedAt: string, entries: readonly { id: string; weight: number; datasetId: string }[]): LeagueCapitalAllocationAdvisory {
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 0.6, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 5, maximumFamilyWeight: 0.6 },
    entries: entries.map((entry, index) => ({
      id: entry.id,
      familyId: `family-${entry.id}`,
      rank: index + 1,
      leagueScore: 100 - index,
      evidenceBreadth: 1,
      researchWeight: entry.weight,
      reasons: ["NO_EXECUTION_AUTHORITY"],
      sourceDatasetIds: [entry.datasetId],
    })),
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: entries.map((entry) => entry.datasetId).sort() },
  };
}

function envelope(index: number, overrides: Partial<PersistedPaperPeriodRecord> = {}, provenance = [
  { candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH_A },
  { candidateId: "candidate-b", datasetId: "dataset-b", datasetContentSha256: HASH_B },
]): PersistedPaperPeriodEnvelope {
  const start = BASE + index * DAY;
  return {
    record: {
      recordId: `period-${index}`,
      periodIndex: index,
      advisory: advisory(new Date(start - 1).toISOString(), [
        { id: "candidate-a", weight: 0.5, datasetId: "dataset-a" },
        { id: "candidate-b", weight: 0.5, datasetId: "dataset-b" },
      ]),
      periodStartAt: start,
      periodEndAt: start + DAY,
      realizedReturns: { "candidate-a": 0.01, "candidate-b": 0.02 },
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: { evidenceId: `cost-${index}`, source: "PAPER_EXECUTION_RECEIPT", observedAt: start + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 },
      status: "COMPLETED",
      ...overrides,
    },
    candidateProvenance: provenance,
  };
}

function code(run: () => unknown): string {
  try { run(); } catch (error) {
    if (error instanceof PersistedPaperForwardEvidenceAdapterError) return error.code;
    throw error;
  }
  throw new Error("expected adapter error");
}

describe("adaptPersistedPaperForwardEvidence", () => {
  it("projects a stable persisted candidate set into candidate-specific admissions with real costs", () => {
    const result = adaptPersistedPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => envelope(index)));
    assert.deepEqual(result.orderedRecordIds.slice(0, 3), ["period-0", "period-1", "period-2"]);
    assert.deepEqual(result.candidates.map((candidate) => candidate.candidateId), ["candidate-a", "candidate-b"]);
    for (const candidate of result.candidates) {
      assert.equal(candidate.periods.length, 30);
      assert.equal(candidate.admission.strength, "VERIFIED");
      assert.equal(candidate.periods[0]!.feeRate, 0.001);
      assert.equal(candidate.periods[0]!.turnover, 0.25);
      assert.deepEqual(candidate.listPaperRealizedPeriods(), candidate.periods);
    }
  });

  it("normalizes input order without changing candidate evidence or admission", () => {
    const forward = adaptPersistedPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => envelope(index)));
    const reversed = adaptPersistedPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => envelope(index)).reverse());
    assert.deepEqual(reversed.orderedRecordIds, forward.orderedRecordIds);
    assert.deepEqual(reversed.candidates.map((candidate) => candidate.candidateId), forward.candidates.map((candidate) => candidate.candidateId));
    for (let index = 0; index < forward.candidates.length; index += 1) {
      assert.deepEqual(reversed.candidates[index]!.periods, forward.candidates[index]!.periods);
      assert.deepEqual(reversed.candidates[index]!.admission, forward.candidates[index]!.admission);
    }
  });

  it("keeps narrow and failed-period evidence fail-closed while retaining the denominator", () => {
    const narrow = adaptPersistedPaperForwardEvidence(Array.from({ length: 29 }, (_, index) => envelope(index)));
    assert.ok(narrow.candidates.every((candidate) => candidate.admission.strength === "INSUFFICIENT"));
    const withHalt = adaptPersistedPaperForwardEvidence(Array.from({ length: 31 }, (_, index) => envelope(index, index === 7 ? { status: "HALTED" } : {})));
    assert.equal(withHalt.candidates[0]!.admission.periodCount, 31);
    assert.equal(withHalt.candidates[0]!.admission.rejectedOrHaltedPeriodCount, 1);
    assert.equal(withHalt.candidates[0]!.admission.strength, "VERIFIED");
  });

  it("rejects candidate-set drift and dataset provenance drift instead of filtering survivors", () => {
    const records = Array.from({ length: 30 }, (_, index) => envelope(index));
    const changedCandidate = envelope(4, {}, [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH_A }]);
    assert.equal(code(() => adaptPersistedPaperForwardEvidence([...records.slice(0, 4), changedCandidate, ...records.slice(5)])), "CANDIDATE_PROVENANCE_SET_MISMATCH");
    const changedDataset = envelope(4, {
      advisory: advisory(new Date(BASE + 4 * DAY - 1).toISOString(), [
        { id: "candidate-a", weight: 0.5, datasetId: "dataset-a-new" },
        { id: "candidate-b", weight: 0.5, datasetId: "dataset-b" },
      ]),
    }, [{ candidateId: "candidate-a", datasetId: "dataset-a-new", datasetContentSha256: HASH_B }, { candidateId: "candidate-b", datasetId: "dataset-b", datasetContentSha256: HASH_B }]);
    assert.equal(code(() => adaptPersistedPaperForwardEvidence([...records.slice(0, 4), changedDataset, ...records.slice(5)])), "DATASET_PROVENANCE_MISMATCH");
  });

  it("rejects cost-rate mismatches and duplicate period indexes", () => {
    const records = Array.from({ length: 30 }, (_, index) => envelope(index));
    assert.equal(code(() => adaptPersistedPaperForwardEvidence([...records.slice(0, 1), envelope(0), ...records.slice(1)])), "DUPLICATE_PERIOD_INDEX");
    assert.equal(code(() => adaptPersistedPaperForwardEvidence([envelope(0, { turnoverCostRate: 0.002 })])), "COST_RATE_RECONCILIATION_MISMATCH");
  });

  it("rejects forbidden fields before projection and leaves the source unchanged", () => {
    const source = envelope(0);
    const forbiddenField = ["access", "Key"].join("");
    const unsafe = { ...source, record: { ...source.record, [forbiddenField]: ["opaque", "fixture"].join("-") } };
    assert.equal(code(() => adaptPersistedPaperForwardEvidence([unsafe])), "FORBIDDEN_FIELD");
    assert.equal(Object.prototype.hasOwnProperty.call(source.record, forbiddenField), false);
  });

  it("is idempotent and does not fabricate a League performance summary", () => {
    const first = adaptPersistedPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => envelope(index)));
    const second = adaptPersistedPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => envelope(index)));
    assert.deepEqual(second.orderedRecordIds, first.orderedRecordIds);
    assert.deepEqual(second.candidates.map((candidate) => ({ candidateId: candidate.candidateId, periods: candidate.periods, admission: candidate.admission })), first.candidates.map((candidate) => ({ candidateId: candidate.candidateId, periods: candidate.periods, admission: candidate.admission })));
    assert.equal("paperPerformance" in first.candidates[0]!, false);
  });
});
