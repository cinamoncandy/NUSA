import assert from "node:assert/strict";
import test from "node:test";
import { validateEvolutionOpportunity } from "./evolveOpportunity";
import { planEvolutionOpportunity } from "./evolvePlanner";

const opportunity = (status: "DISCOVERED" | "READY" | "REJECTED" = "READY") =>
  validateEvolutionOpportunity({
    id: "ci:failure-rate",
    source: "github.ci",
    problem: "Repeated CI failures increase autonomous cycle cost.",
    evidence: [{ source: "github.ci", reference: "run:123", quality: 0.9 }],
    impact: 0.8,
    confidence: 0.9,
    risk: 0.2,
    reversibility: 0.9,
    status,
    createdAt: "2026-08-29T00:00:00Z",
  });

test("creates a bounded plan from a ready opportunity", () => {
  const plan = planEvolutionOpportunity(opportunity());
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.opportunityId, "ci:failure-rate");
  assert.ok(plan.hypothesis.length > 0);
  assert.ok(plan.implementationSteps.length >= 2);
  assert.ok(plan.validationSteps.length >= 2);
  assert.ok(plan.rollbackPlan.length > 0);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.implementationSteps), true);
});

test("fails closed for non-plannable opportunities", () => {
  const plan = planEvolutionOpportunity(opportunity("REJECTED"));
  assert.equal(plan.status, "ABSTAINED");
  assert.equal(plan.implementationSteps.length, 0);
  assert.equal(plan.rollbackPlan, "");
});
