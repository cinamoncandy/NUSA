import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEvolutionOutcome } from "./evolveOutcome";

test("classifies an evidenced outcome deterministically", () => {
  const result = evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run:123"],
    observedAt: "2026-08-29T00:00:00Z",
  });
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(Object.isFrozen(result), true);
});

test("fails closed without evidence", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 81,
    evidence: [],
  }), /EVOLVE_OUTCOME_EVIDENCE_REQUIRED/);
});
