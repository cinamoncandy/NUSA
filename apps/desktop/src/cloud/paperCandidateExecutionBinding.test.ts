import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import {
  bindPaperCandidateForExecution,
  PaperCandidateExecutionBindingError,
} from "./paperCandidateExecutionBinding";

const HASH = "a".repeat(64);
const GENERATED_AT = "2026-08-28T00:00:00.000Z";
const START_AT = Date.parse(GENERATED_AT) + 1_000;

function advisory(): LeagueCapitalAllocationAdvisory {
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    policy: Object.freeze({
      maximumCandidateWeight: 1,
      minimumEvidenceBreadth: 0,
      maximumCandidateCount: 1,
      maximumFamilyWeight: 1,
    }),
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

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperCandidateExecutionBindingError) return error.code;
    throw error;
  }
  throw new Error("expected PaperCandidateExecutionBindingError");
}

describe("PAPER candidate execution binding", () => {
  it("deterministically binds one League entry to exact persisted dataset provenance without granting authority", () => {
    const first = bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }], "candidate-a", START_AT);
    const replay = bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }], "candidate-a", START_AT);

    assert.deepEqual(replay, first);
    assert.equal(first.status, "BOUND_UNVERIFIED");
    assert.equal(first.authority, "PAPER_RESEARCH_ONLY");
    assert.equal(first.liveAuthority, "NONE");
    assert.equal(first.productionMutationAllowed, false);
    assert.equal(first.candidateId, "candidate-a");
    assert.equal(first.datasetId, "dataset-a");
    assert.match(first.advisoryFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.match(first.bindingFingerprintSha256, /^[a-f0-9]{64}$/);
  });

  it("rejects a generic or missing execution identity that is not an actual advisory candidate", () => {
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }], "CIO_PAPER", START_AT)), "CANDIDATE_NOT_IN_ADVISORY");
  });

  it("rejects missing, duplicated, or mismatched persisted candidate provenance", () => {
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [], "candidate-a", START_AT)), "MISSING_CANDIDATE_PROVENANCE");
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [
      { candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH },
      { candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH },
    ], "candidate-a", START_AT)), "DUPLICATE_CANDIDATE_PROVENANCE");
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-other", datasetContentSha256: HASH }], "candidate-a", START_AT)), "DATASET_PROVENANCE_MISMATCH");
  });

  it("rejects same-period or future advisory binding", () => {
    const generatedAt = Date.parse(GENERATED_AT);
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }], "candidate-a", generatedAt)), "LOOKAHEAD_CANDIDATE_BINDING");
    assert.equal(codeOf(() => bindPaperCandidateForExecution(advisory(), [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }], "candidate-a", generatedAt - 1)), "LOOKAHEAD_CANDIDATE_BINDING");
  });
});
