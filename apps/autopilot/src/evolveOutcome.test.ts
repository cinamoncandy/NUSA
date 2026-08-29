import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEvolutionOutcome } from "./evolveOutcome";

const TRUSTED = ["run:123"] as const;

test("classifies an evidenced outcome deterministically", () => {
  const result = evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run:123"],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  });
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(Object.isFrozen(result), true);
});

test("fails closed when the deterministic observation timestamp is missing", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 81,
    evidence: ["run:123"],
    trustedEvidenceReferences: TRUSTED,
  }), /EVOLVE_OUTCOME_OBSERVED_AT_REQUIRED/);
});

test("fails closed without evidence", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 81,
    evidence: [],
    trustedEvidenceReferences: TRUSTED,
  }), /EVOLVE_OUTCOME_EVIDENCE_REQUIRED/);
});

test("fails closed on blank or malformed evidence references", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["   "],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_EVIDENCE_INVALID/);
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run id with spaces"],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_EVIDENCE_INVALID/);
});

test("fails closed on malformed outcome input types", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: 17 as never,
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run:123"],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_OPPORTUNITY_REQUIRED/);
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: [17 as never],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_EVIDENCE_INVALID/);
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run:123"],
    trustedEvidenceReferences: ["run:123", 17 as never],
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_EVIDENCE_INVALID/);
});
test("fails closed on caller-fabricated evidence not present in the trusted binding set", () => {
  assert.throws(() => evaluateEvolutionOutcome({
    opportunityId: "ci:failure-rate",
    expectedMetric: 80,
    actualMetric: 80,
    evidence: ["run:999"],
    trustedEvidenceReferences: TRUSTED,
    observedAt: "2026-08-29T00:00:00Z",
  }), /EVOLVE_OUTCOME_EVIDENCE_UNBOUND/);
});
