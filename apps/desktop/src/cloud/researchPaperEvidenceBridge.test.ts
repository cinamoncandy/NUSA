import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord } from "../../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { ResearchRunCandidate } from "./researchRunLeagueBridge";
import { attachPersistedPaperForwardEvidence } from "./researchPaperEvidenceBridge";

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function advisory(generatedAt: string): LeagueCapitalAllocationAdvisory {
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 0.6, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 5, maximumFamilyWeight: 0.6 },
    entries: [
      { id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 100, evidenceBreadth: 1, researchWeight: 0.5, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] },
      { id: "candidate-b", familyId: "family-b", rank: 2, leagueScore: 99, evidenceBreadth: 1, researchWeight: 0.5, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-b"] },
    ],
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a", "dataset-b"] },
  };
}

function envelope(index: number, overrides: Partial<PersistedPaperPeriodRecord> = {}): PersistedPaperPeriodEnvelope {
  const start = BASE + index * DAY;
  return {
    record: {
      recordId: `period-${index}`,
      periodIndex: index,
      advisory: advisory(new Date(start - 1).toISOString()),
      periodStartAt: start,
      periodEndAt: start + DAY,
      realizedReturns: { "candidate-a": 0.01, "candidate-b": 0.02 },
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: { evidenceId: `cost-${index}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: HASH_A, observedAt: start + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 },
      status: "COMPLETED",
      ...overrides,
    },
    candidateProvenance: [
      { candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH_A },
      { candidateId: "candidate-b", datasetId: "dataset-b", datasetContentSha256: HASH_B },
    ],
  };
}

function candidate(id: "candidate-a" | "candidate-b", hash: string): ResearchRunCandidate {
  const datasetId = id === "candidate-a" ? "dataset-a" : "dataset-b";
  return {
    id,
    familyId: id === "candidate-a" ? "family-a" : "family-b",
    experiment: { manifest: { datasetId, contentSha256: hash } },
  } as ResearchRunCandidate;
}

const performance: PaperPerformanceSummary = {
  startedAt: BASE,
  endedAt: BASE + 30 * DAY,
  observationDays: 30,
  tradeCount: 30,
  netReturn: 0.1,
  sharpeRatio: 1,
  profitFactor: 1.2,
  maximumDrawdown: 0.05,
  availabilityRatio: 1,
  unresolvedFaultCount: 0,
  killSwitchActivationCount: 0,
  executionQualityScore: 1,
};

const periods = () => Array.from({ length: 30 }, (_, index) => envelope(index));
const candidates = () => [candidate("candidate-a", HASH_A), candidate("candidate-b", HASH_B)];

describe("canonical PAPER performance -> Research feedback integration", () => {
  it("preserves candidate/dataset provenance and attaches only authoritative performance", () => {
    const result = attachPersistedPaperForwardEvidence(candidates(), periods(), { read: () => performance });
    assert.deepEqual(result.matchedCandidateIds, ["candidate-a", "candidate-b"]);
    assert.deepEqual(result.awaitingPerformanceCandidateIds, []);
    assert.deepEqual(result.orderedRecordIds, Array.from({ length: 30 }, (_, index) => `period-${index}`));
    assert.equal(result.candidates[0]!.paperForwardEvidence?.admission.strength, "VERIFIED");
    assert.deepEqual(result.candidates[0]!.paperForwardEvidence?.paperPerformance, performance);
  });

  it("fails closed when authoritative performance is absent", () => {
    const result = attachPersistedPaperForwardEvidence(candidates(), periods(), { read: () => undefined });
    assert.deepEqual(result.matchedCandidateIds, []);
    assert.deepEqual(result.awaitingPerformanceCandidateIds, ["candidate-a", "candidate-b"]);
    assert.equal(result.candidates.some((item) => item.paperForwardEvidence != null), false);
  });

  it("fails closed when Research dataset provenance disagrees with PAPER evidence", () => {
    const mismatched = [candidate("candidate-a", HASH_B), candidate("candidate-b", HASH_B)];
    assert.throws(
      () => attachPersistedPaperForwardEvidence(mismatched, periods(), { read: () => performance }),
      /research PAPER evidence provenance mismatch for candidate-a/,
    );
  });

  it("is deterministic for the same immutable PAPER evidence", () => {
    const first = attachPersistedPaperForwardEvidence(candidates(), periods(), { read: () => performance });
    const second = attachPersistedPaperForwardEvidence(candidates(), periods().reverse(), { read: () => performance });
    assert.deepEqual(second.orderedRecordIds, first.orderedRecordIds);
    assert.deepEqual(second.matchedCandidateIds, first.matchedCandidateIds);
    assert.deepEqual(second.candidates.map((item) => item.paperForwardEvidence), first.candidates.map((item) => item.paperForwardEvidence));
  });
});
