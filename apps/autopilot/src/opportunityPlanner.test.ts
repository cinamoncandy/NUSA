import { describe, expect, it } from "vitest";
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
    expect(result.score).toBeNull();
    expect(result.reason).toBe("deduplicated-existing-canonical-work");
    expect(result.mutationAllowed).toBe(false);
  });

  it("does not promote UNKNOWN evidence into a ranked candidate", () => {
    const result = planOpportunity({ ...verified("ci:p95", 5), confidence: "UNKNOWN" }, []);
    expect(result.score).toBeNull();
    expect(result.reason).toBe("insufficient-evidence-for-ranking");
  });

  it("fails closed when a ranking input is absent", () => {
    const result = planOpportunity({ ...verified("queue:age", 5), effortCost: null }, []);
    expect(result.score).toBeNull();
    expect(result.reason).toBe("insufficient-evidence-for-ranking");
  });

  it("ranks only evidence-backed advisory candidates deterministically", () => {
    const low = planOpportunity(verified("candidate:b", 3), []);
    const high = planOpportunity(verified("candidate:a", 8), []);
    const unknown = planOpportunity({ ...verified("candidate:c", 100), confidence: "INSUFFICIENT" }, []);

    expect(rankOpportunities([low, unknown, high]).map((candidate) => candidate.key)).toEqual([
      "candidate:a",
      "candidate:b",
      "candidate:c",
    ]);
    expect(high.reason).toBe("evidence-backed-advisory-ranking");
    expect(high.mutationAllowed).toBe(false);
  });
});
