import assert from "node:assert/strict";
import test from "node:test";
import {
  rankEngineeringOpportunities,
  scoreEngineeringOpportunity,
  type EngineeringOpportunityPriorityInput,
} from "./nusaEngineeringPortfolioScheduler.js";

function opportunity(
  opportunityId: string,
  overrides: Partial<EngineeringOpportunityPriorityInput> = {},
): EngineeringOpportunityPriorityInput {
  return {
    opportunityId,
    expectedProductValue: 70,
    riskReduction: 50,
    evidenceGain: 60,
    criticalPathUnlock: 40,
    effortCost: 30,
    dependencyFanOut: 20,
    uncertainty: 10,
    ...overrides,
  };
}

test("ranks deterministic evidence scores highest first", () => {
  const ranked = rankEngineeringOpportunities([
    opportunity("low", { expectedProductValue: 20, criticalPathUnlock: 10 }),
    opportunity("high", { expectedProductValue: 90, criticalPathUnlock: 90 }),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["high", "low"]);
  assert.equal(ranked[0]?.classification, "RANKABLE");
  assert.equal(typeof ranked[0]?.score, "number");
});

test("fails closed when any priority input is unknown", () => {
  const result = scoreEngineeringOpportunity(opportunity("unknown-risk", { riskReduction: "UNKNOWN" }));

  assert.equal(result.classification, "INSUFFICIENT");
  assert.equal(result.score, null);
  assert.deepEqual(result.reasons, ["UNKNOWN_RISKREDUCTION"]);
});

test("keeps insufficient opportunities below rankable evidence", () => {
  const ranked = rankEngineeringOpportunities([
    opportunity("unknown", { effortCost: "UNKNOWN" }),
    opportunity("known"),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["known", "unknown"]);
});

test("uses opportunity id as stable tie breaker", () => {
  const ranked = rankEngineeringOpportunities([opportunity("b"), opportunity("a")]);
  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["a", "b"]);
});

test("rejects fabricated out-of-range confidence components", () => {
  assert.throws(
    () => scoreEngineeringOpportunity(opportunity("bad", { uncertainty: 101 })),
    /ENGINEERING_PRIORITY_INVALID_UNCERTAINTY/,
  );
});
