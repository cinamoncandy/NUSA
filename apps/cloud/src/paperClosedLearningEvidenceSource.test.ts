import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { PaperClosedLearningEvidenceSource } from "./paperClosedLearningEvidenceSource";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SOURCE = "1".repeat(40);

function envelope(recordId: string, periodIndex: number): PersistedPaperPeriodEnvelope {
  return {
    schemaVersion: 1,
    record: {
      schemaVersion: 1,
      recordId,
      periodId: `period-${periodIndex}`,
      periodIndex,
      status: "COMPLETED",
      candidateId: "candidate-a",
      datasetId: "dataset-a",
      datasetContentSha256: HASH_A,
      periodStartAt: 1_000 + periodIndex * 1_000,
      periodEndAt: 1_500 + periodIndex * 1_000,
      grossReturn: 0.01,
      netReturn: 0.009,
      turnover: 0.2,
      feeRate: 0.0005,
      slippageRate: 0.0005,
      rejectedOrHalted: false,
      benchmarkNetReturn: 0.005,
      benchmarkId: "benchmark-a",
      benchmarkProvenanceSha256: HASH_B,
      executionCostEvidenceId: `cost-${periodIndex}`,
      executionCostEvidenceSha256: HASH_B,
      reconciliationStatus: "VERIFIED",
      createdAt: 1_600 + periodIndex * 1_000,
    },
    persistedAt: 1_700 + periodIndex * 1_000,
    recordSha256: HASH_B,
  } as PersistedPaperPeriodEnvelope;
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
    const bad = envelope("record-bad", 0) as unknown as { record: Record<string, unknown> };
    const adverse = { ...bad, record: { ...bad.record, netReturn: -0.1, rejectedOrHalted: true } } as unknown as PersistedPaperPeriodEnvelope;
    const result = source([adverse]).read();
    assert.ok(result);
    assert.deepEqual(result.evidenceReferences, ["paper-period:record-bad"]);
  });

  it("fails closed on ambiguous duplicate period chronology", () => {
    assert.throws(() => source([envelope("a", 0), envelope("b", 0)]).read(), /chronology is ambiguous/);
  });
});
