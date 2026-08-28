import assert from "node:assert/strict";
import test from "node:test";
import { validateEvolutionOpportunity } from "./evolveOpportunity";
import { rankEvolutionOpportunity, rankEvolutionOpportunities } from "./evolveRanking";

const opportunity = (overrides: Record<string, unknown> = {}) => validateEvolutionOpportunity({
  id: "ci:failure-rate",
  source: "github.ci",
  problem: "Repeated CI failures increase autonomous cycle cost.",
  evidence: [{ source: "github.ci", reference: "run:123", quality: 0.9 }],
  impact: 0.8,
  confidence: 0.9,
  risk: 0.2,
  reversibility: 0.9,
  status: "READY",
  createdAt: "2026-08-29T00:00:00Z",
  ...overrides,
});

test("validates and freezes a bounded opportunity", () => {
  const value = opportunity();
  assert.equal(value.id, "ci:failure-rate");
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.evidence), true);
});

test("rejects missing evidence and out-of-range risk", () => {
  assert.throws(() => opportunity({ evidence: [] }), /EVOLVE_OPPORTUNITY_EVIDENCE_REQUIRED/);
  assert.throws(() => opportunity({ risk: 1.1 }), /EVOLVE_OPPORTUNITY_RISK_INVALID/);
});

test("ranks by impact, confidence, evidence, reversibility and bounded risk", () => {
  const ranked = rankEvolutionOpportunity(opportunity());
  assert.equal(ranked.eligible, true);
  assert.ok(ranked.score > 0);
  assert.equal(ranked.evidenceQuality, 0.9);
});

test("sorts deterministically and does not let rejected work become eligible", () => {
  const ranked = rankEvolutionOpportunities([
    opportunity({ id: "b", impact: 0.5 }),
    opportunity({ id: "a", impact: 0.5 }),
    opportunity({ id: "rejected", status: "REJECTED" }),
  ]);
  assert.deepEqual(ranked.map((item) => item.opportunityId), ["a", "b", "rejected"]);
  assert.equal(ranked[2].eligible, false);
});
