import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideResearchFactoryOutcome, type ResearchFactoryEvidence } from "./researchFactoryOutcome";

const allPass = (): ResearchFactoryEvidence => ({
  provenanceIntegrity: "PASS",
  costEvidence: "PASS",
  outOfSampleEvidence: "PASS",
  multipleTestingControl: "PASS",
  regimeRobustness: "PASS",
  sensitivityAndStress: "PASS",
  denominatorIntegrity: "PASS",
  replayDeterminism: "PASS",
});

const decide = (evidence: ResearchFactoryEvidence) => decideResearchFactoryOutcome({
  candidateId: "candidate-1",
  evaluationId: "evaluation-1",
  evidence,
});

describe("decideResearchFactoryOutcome", () => {
  it("qualifies only when every required evidence family passes", () => {
    const result = decide(allPass());
    assert.equal(result.outcome, "QUALIFIED_FOR_LEAGUE");
    assert.deepEqual(result.reasons, ["ALL_REQUIRED_RESEARCH_EVIDENCE_PASSED"]);
    assert.equal(result.authority, "PAPER_ONLY");
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  });

  it("returns INSUFFICIENT when evidence is unknown and no failure is known", () => {
    const evidence = { ...allPass(), regimeRobustness: "UNKNOWN" as const };
    const result = decide(evidence);
    assert.equal(result.outcome, "INSUFFICIENT");
    assert.deepEqual(result.reasons, ["MISSING:regimeRobustness"]);
  });

  it("known counter-evidence dominates unresolved evidence", () => {
    const evidence = {
      ...allPass(),
      costEvidence: "FAIL" as const,
      outOfSampleEvidence: "UNKNOWN" as const,
    };
    const result = decide(evidence);
    assert.equal(result.outcome, "REJECTED");
    assert.deepEqual(result.reasons, ["FAILED:costEvidence"]);
  });

  it("reports every failed gate deterministically in canonical key order", () => {
    const evidence = {
      ...allPass(),
      provenanceIntegrity: "FAIL" as const,
      regimeRobustness: "FAIL" as const,
      replayDeterminism: "FAIL" as const,
    };
    assert.deepEqual(decide(evidence).reasons, [
      "FAILED:provenanceIntegrity",
      "FAILED:regimeRobustness",
      "FAILED:replayDeterminism",
    ]);
  });

  it("fails closed on malformed identity or evidence state", () => {
    assert.throws(() => decideResearchFactoryOutcome({ candidateId: "", evaluationId: "e", evidence: allPass() }), /CANDIDATE_ID_INVALID/);
    assert.throws(() => decideResearchFactoryOutcome({
      candidateId: "c",
      evaluationId: "e",
      evidence: { ...allPass(), costEvidence: "READY" as never },
    }), /EVIDENCE_STATE_INVALID:costEvidence/);
  });
});
