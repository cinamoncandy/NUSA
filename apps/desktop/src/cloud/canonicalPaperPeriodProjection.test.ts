import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperPeriodCostEvidence } from "../../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import { bindPaperCandidateForExecution } from "./paperCandidateExecutionBinding";
import {
  CanonicalPaperPeriodProjectionError,
  projectCanonicalPaperRealizedPeriod,
} from "./canonicalPaperPeriodProjection";

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
      id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1,
      reasons: Object.freeze(["RESEARCH_ONLY_ALLOCATION_ADVISORY"]), sourceDatasetIds: Object.freeze(["dataset-a"]),
    })]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze(["NO_EXECUTION_AUTHORITY"]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
  });
}

function input() {
  const value = advisory();
  return {
    periodIndex: 7,
    periodStartAt: START,
    periodEndAt: END,
    advisory: value,
    candidateProvenance: provenance,
    outcomes: [{ candidateId: "candidate-a", binding: bindPaperCandidateForExecution(value, provenance, "candidate-a", START), grossReturn: 0.01 }],
    benchmarkReturn: 0.002,
    turnoverCostRate: 0.0015,
    costEvidence: {
      evidenceId: "paper-cost-evidence-a",
      source: "PAPER_EXECUTION_RECEIPT" as const,
      evidenceKind: "OBSERVED" as const,
      evidenceFingerprintSha256: HASH,
      observedAt: END,
      feeRate: 0.0005,
      spreadRate: 0.0004,
      slippageRate: 0.0006,
    },
    status: "COMPLETED" as const,
  };
}

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof CanonicalPaperPeriodProjectionError) return error.code;
    throw error;
  }
  throw new Error("expected CanonicalPaperPeriodProjectionError");
}

describe("canonical PAPER realized-period projection", () => {
  it("deterministically projects an exact candidate-bound realized interval into the #885 envelope", () => {
    const first = projectCanonicalPaperRealizedPeriod(input());
    const replay = projectCanonicalPaperRealizedPeriod(input());
    assert.deepEqual(replay, first);
    assert.match(first.record.recordId, /^paper-period-[a-f0-9]{64}$/);
    assert.equal(first.record.realizedReturns["candidate-a"], 0.01);
    assert.equal(first.record.costEvidence.source, "PAPER_EXECUTION_RECEIPT");
    assert.deepEqual(first.candidateProvenance, provenance);
  });

  it("rejects a binding from a different period instead of accepting caller candidate text", () => {
    const value = input();
    const wrong = bindPaperCandidateForExecution(value.advisory, provenance, "candidate-a", START + 1);
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, outcomes: [{ ...value.outcomes[0]!, binding: wrong }] })), "CANDIDATE_BINDING_MISMATCH");
  });

  it("rejects missing candidates or provenance drift", () => {
    const value = input();
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, outcomes: [] })), "CANDIDATE_SET_MISMATCH");
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, candidateProvenance: [{ ...provenance[0]!, datasetContentSha256: "b".repeat(64) }] })), "CANDIDATE_PROVENANCE_MISMATCH");
  });

  it("rejects incomplete or unreconciled execution cost evidence", () => {
    const value = input();
    const invalidSource = { ...value.costEvidence, source: "CONSERVATIVE_MODEL" } as unknown as PaperPeriodCostEvidence;
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, costEvidence: invalidSource })), "INVALID_COST_PROVENANCE");
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, turnoverCostRate: 0.0014 })), "COST_RECONCILIATION_MISMATCH");
  });

  it("rejects cost receipts outside the realized interval", () => {
    const value = input();
    assert.equal(codeOf(() => projectCanonicalPaperRealizedPeriod({ ...value, costEvidence: { ...value.costEvidence, observedAt: START - 1 } })), "INVALID_COST_PROVENANCE");
  });
});
