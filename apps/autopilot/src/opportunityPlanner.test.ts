import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planOpportunity, rankOpportunities } from "./opportunityPlanner";

const verified = (key: string, expectedValue: number) => ({
  key,
  source: "github-evidence",
  confidence: "VERIFIED" as const,
  expectedValue,
  riskReduction: 2,
  evidenceGain: 1,
  criticalPathUnlock: 3,
  effortCost: 2,
  uncertainty: 1,
});

describe("opportunityPlanner", () => {
  it("deduplicates against canonical existing work", () => {
    const result = planOpportunity(verified("issue:903", 5), [{ key: "issue:903" }]);
    assert.equal(result.score, null);
    assert.equal(result.reason, "deduplicated-existing-canonical-work");
    assert.equal(result.mutationAllowed, false);
  });

  it("does not promote UNKNOWN evidence into a ranked candidate", () => {
    const result = planOpportunity({ ...verified("ci:p95", 5), confidence: "UNKNOWN" }, []);
    assert.equal(result.score, null);
    assert.equal(result.reason, "insufficient-evidence-for-ranking");
  });

  it("fails closed when a ranking input is absent", () => {
    const result = planOpportunity({ ...verified("queue:age", 5), effortCost: null }, []);
    assert.equal(result.score, null);
    assert.equal(result.reason, "insufficient-evidence-for-ranking");
  });

  it("ranks only evidence-backed advisory candidates deterministically", () => {
    const low = planOpportunity(verified("candidate:b", 3), []);
    const high = planOpportunity(verified("candidate:a", 8), []);
    const unknown = planOpportunity({ ...verified("candidate:c", 100), confidence: "INSUFFICIENT" }, []);

    assert.deepEqual(rankOpportunities([low, unknown, high]).map((candidate) => candidate.key), [
      "candidate:a",
      "candidate:b",
      "candidate:c",
    ]);
    assert.equal(high.reason, "evidence-backed-advisory-ranking");
    assert.equal(high.mutationAllowed, false);
  });
});
