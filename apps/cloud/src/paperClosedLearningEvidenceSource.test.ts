import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { PaperClosedLearningEvidenceSource } from "./paperClosedLearningEvidenceSource";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SOURCE = "1".repeat(40);

const advisory: LeagueCapitalAllocationAdvisory = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(500).toISOString(),
  policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
  entries: Object.freeze([{ id: "candidate-a", familyId: "sma", rank: 1, leagueScore: 1, evidenceBreadth: 5, researchWeight: 1, reasons: Object.freeze(["qualified"]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["research-only allocation"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
});

function envelope(recordId: string, periodIndex: number, status: "COMPLETED" | "REJECTED" | "HALTED" = "COMPLETED", realizedReturn = 0.009): PersistedPaperPeriodEnvelope {
  const periodStartAt = 1_000 + periodIndex * 1_000;
  return Object.freeze({
    record: Object.freeze({
      recordId,
      periodIndex,
      market: "KRW-BTC",
      advisory,
      periodStartAt,
      periodEndAt: periodStartAt + 500,
      realizedReturns: Object.freeze({ "candidate-a": realizedReturn }),
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: Object.freeze({
        evidenceId: `cost-${periodIndex}`,
        source: "PAPER_EXECUTION_RECEIPT" as const,
        evidenceKind: "OBSERVED" as const,
        evidenceFingerprintSha256: HASH_B,
        observedAt: periodStartAt + 450,
        feeRate: 0.0005,
        spreadRate: 0,
        slippageRate: 0.0005,
      }),
      benchmarkEvidenceId: `benchmark-${periodIndex}`,
      canonicalOutcomeReceiptFingerprint: HASH_B,
      status,
    }),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH_A }]),
  });
}

function source(periods: readonly PersistedPaperPeriodEnvelope[], championVersion = "v1") {
  return new PaperClosedLearningEvidenceSource({
    listPaperRealizedPeriods: () => periods,
    champion: () => ({ championId: "champion-a", championVersion }),
    sourceCommitSha: SOURCE,
    costModelVersion: "paper-cost-v3",
    riskConfigHash: HASH_B,
  });
}

describe("PaperClosedLearningEvidenceSource", () => {
  it("returns identical identity for identical persisted evidence replay", () => {
    const periods = [envelope("record-1", 0), envelope("record-2", 1)];
    assert.deepEqual(source(periods).read(), source([...periods].reverse()).read());
  });

  it("changes identity when a new authoritative period arrives", () => {
    const first = source([envelope("record-1", 0)]).read();
    const second = source([envelope("record-1", 0), envelope("record-2", 1)]).read();
    assert.notEqual(first?.evidenceFingerprintSha256, second?.evidenceFingerprintSha256);
  });

  it("changes identity when immutable champion version changes", () => {
    const periods = [envelope("record-1", 0)];
    assert.notEqual(source(periods, "v1").read()?.evidenceFingerprintSha256, source(periods, "v2").read()?.evidenceFingerprintSha256);
  });

  it("does not filter adverse or halted period records", () => {
    const result = source([envelope("record-bad", 0, "HALTED", -0.1)]).read();
    assert.ok(result);
    assert.deepEqual(result.evidenceReferences, ["paper-period:record-bad"]);
  });

  it("fails closed on ambiguous duplicate period chronology", () => {
    assert.throws(() => source([envelope("a", 0), envelope("b", 0)]).read(), /chronology is ambiguous/);
  });
});
