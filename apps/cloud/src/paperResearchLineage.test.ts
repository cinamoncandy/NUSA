import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";

const lineage: PaperResearchLineage = Object.freeze({
  schemaVersion: 1,
  candidateId: "challenger-a",
  candidateVersion: "specification-hash-v1",
  originalRunFingerprintSha256: "a".repeat(64),
  replayRunFingerprintSha256: "b".repeat(64),
  researchDecisionReference: "research-replay:decision-1",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

describe("PAPER Research lineage", () => {
  it("normalizes immutable Research replay identity without granting authority", () => {
    const result = validatePaperResearchLineage(lineage);
    assert.equal(result.originalRunFingerprintSha256, "a".repeat(64));
    assert.equal(result.replayRunFingerprintSha256, "b".repeat(64));
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  });

  it("fails closed on fingerprint or authority drift", () => {
    assert.throws(() => validatePaperResearchLineage({ ...lineage, originalRunFingerprintSha256: "bad" }), /fingerprint/);
    assert.throws(() => validatePaperResearchLineage({ ...lineage, liveAuthority: "LIVE" as never }), /authority/);
  });

  it("compares the complete immutable lineage identity", () => {
    assert.equal(samePaperResearchLineage(lineage, { ...lineage }), true);
    assert.equal(samePaperResearchLineage(lineage, { ...lineage, replayRunFingerprintSha256: "c".repeat(64) }), false);
  });
});
