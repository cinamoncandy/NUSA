import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import { bindPaperCandidateForExecution } from "./paperCandidateExecutionBinding";
import type { CanonicalPaperRealizedPeriodInput } from "./canonicalPaperPeriodProjection";
import {
  reconcileCanonicalPaperPeriodProjection,
  type PersistedPaperPeriodProjectionSink,
} from "./canonicalPaperPeriodRecovery";
import type { PersistedPaperPeriodEnvelope } from "./persistedPaperPeriodStore";

const HASH = "a".repeat(64);
const GENERATED_AT = "2026-08-28T00:00:00.000Z";
const START = Date.parse(GENERATED_AT) + 1_000;
const END = START + 60_000;
const provenance = Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]);

function advisory(): LeagueCapitalAllocationAdvisory {
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([Object.freeze({
      id: "candidate-a",
      familyId: "family-a",
      rank: 1,
      leagueScore: 1,
      evidenceBreadth: 1,
      researchWeight: 1,
      reasons: Object.freeze(["RESEARCH_ONLY_ALLOCATION_ADVISORY"]),
      sourceDatasetIds: Object.freeze(["dataset-a"]),
    })]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze(["NO_EXECUTION_AUTHORITY"]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
  });
}

function period(periodIndex = 1): CanonicalPaperRealizedPeriodInput {
  const value = advisory();
  return Object.freeze({
    periodIndex,
    periodStartAt: START + (periodIndex - 1) * 120_000,
    periodEndAt: END + (periodIndex - 1) * 120_000,
    advisory: value,
    candidateProvenance: provenance,
    outcomes: Object.freeze([Object.freeze({
      candidateId: "candidate-a",
      binding: bindPaperCandidateForExecution(value, provenance, "candidate-a", START + (periodIndex - 1) * 120_000),
      grossReturn: 0.01,
    })]),
    benchmarkReturn: 0.002,
    turnoverCostRate: 0.0015,
    costEvidence: Object.freeze({
      evidenceId: `paper-cost-${periodIndex}`,
      source: "PAPER_EXECUTION_RECEIPT" as const,
      evidenceKind: "OBSERVED" as const,
      evidenceFingerprintSha256: HASH,
      observedAt: END + (periodIndex - 1) * 120_000,
      feeRate: 0.0005,
      spreadRate: 0.0004,
      slippageRate: 0.0006,
    }),
    status: "COMPLETED" as const,
  });
}

function memorySink(): PersistedPaperPeriodProjectionSink & { rows: PersistedPaperPeriodEnvelope[]; appendCalls: number } {
  const rows: PersistedPaperPeriodEnvelope[] = [];
  return {
    rows,
    appendCalls: 0,
    list: () => rows,
    append(envelope) {
      this.appendCalls += 1;
      const existing = rows.find((item) => item.record.recordId === envelope.record.recordId);
      if (existing != null) {
        assert.deepEqual(existing, envelope);
        return existing;
      }
      rows.push(envelope);
      return envelope;
    },
  };
}

describe("canonical PAPER crash-window projection recovery", () => {
  it("repairs a durable-close-before-append crash exactly once across restarts", () => {
    const source = { listDurablyClosedPeriods: () => [period()] };
    const sink = memorySink();

    const firstBoot = reconcileCanonicalPaperPeriodProjection(source, sink);
    assert.equal(firstBoot.scanned, 1);
    assert.equal(firstBoot.projected, 1);
    assert.equal(firstBoot.alreadyProjected, 0);
    assert.equal(sink.rows.length, 1);
    assert.equal(sink.appendCalls, 1);

    const restart = reconcileCanonicalPaperPeriodProjection(source, sink);
    assert.equal(restart.scanned, 1);
    assert.equal(restart.projected, 0);
    assert.equal(restart.alreadyProjected, 1);
    assert.equal(sink.rows.length, 1);
    assert.equal(sink.appendCalls, 1);
  });

  it("replays out-of-order durable closes in canonical period order", () => {
    const source = { listDurablyClosedPeriods: () => [period(2), period(1)] };
    const sink = memorySink();
    const report = reconcileCanonicalPaperPeriodProjection(source, sink);
    assert.equal(report.projected, 2);
    assert.deepEqual(sink.rows.map((row) => row.record.periodIndex), [1, 2]);
  });

  it("fails closed for malformed durable outcomes while preserving other recoverable periods", () => {
    const bad = { ...period(1), turnoverCostRate: 0.0014 };
    const source = { listDurablyClosedPeriods: () => [bad, period(2)] };
    const sink = memorySink();
    const report = reconcileCanonicalPaperPeriodProjection(source, sink);
    assert.equal(report.projected, 1);
    assert.equal(report.rejected.length, 1);
    assert.equal(report.rejected[0]?.periodIndex, 1);
    assert.match(report.rejected[0]?.reason ?? "", /reconcile/i);
    assert.deepEqual(sink.rows.map((row) => row.record.periodIndex), [2]);
    assert.deepEqual(report.authority, { liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
  });
});
