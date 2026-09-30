import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvolutionValidationResult,
  isPromotionEligible,
  validateEvolutionValidationResult,
} from "./evolveValidation";

const HEAD = "a".repeat(40);

function valid() {
  return {
    opportunityId: "opportunity:validation",
    status: "PASS" as const,
    exactHeadSha: HEAD,
    evidence: [{ check: "CI", reference: "workflow:123", passed: true }],
    heldOutEvidence: [{ check: "held-out/generalization", reference: "heldout:1", passed: true }],
    benefitCostEvidence: [{
      telemetryReference: "telemetry:1",
      budgetState: "NORMAL" as const,
      baselineBenefit: 1,
      observedBenefit: 2,
      baselineCost: 1,
      observedCost: 1,
      benefitDelta: 1,
      costDelta: 0,
      netBenefitDelta: 1,
      passed: true,
    }],
    reason: "exact-head validation passed",
  };
}

test("rejects unknown validation states at the runtime boundary", () => {
  assert.throws(
    () => validateEvolutionValidationResult({ ...valid(), status: "UNKNOWN" }),
    /EVOLVE_VALIDATION_STATUS_INVALID/,
  );
});

test("rejects malformed validation evidence instead of accepting a truthy payload", () => {
  assert.throws(
    () => validateEvolutionValidationResult({ ...valid(), evidence: [{ check: "CI", reference: "workflow:123", passed: "yes" }] }),
    /EVOLVE_VALIDATION_RESULT_INVALID/,
  );
  assert.throws(
    () => validateEvolutionValidationResult({ ...valid(), evidence: [{ check: "CI", reference: "not safe", passed: true }] }),
    /EVOLVE_VALIDATION_REFERENCE_INVALID/,
  );
});

test("PASS cannot become promotion-eligible when any canonical evidence check failed", () => {
  const result = createEvolutionValidationResult({
    ...valid(),
    evidence: [
      { check: "CI", reference: "workflow:123", passed: true },
      { check: "security", reference: "workflow:124", passed: false },
    ],
  });
  assert.equal(isPromotionEligible(result), false);
});

test("normalizes validated identity and evidence immutably", () => {
  const result = createEvolutionValidationResult({
    ...valid(),
    opportunityId: "  opportunity:validation  ",
    reason: "  exact-head validation passed  ",
    evidence: [{ check: "  CI  ", reference: "workflow:123", passed: true }],
  });
  assert.equal(result.opportunityId, "opportunity:validation");
  assert.equal(result.reason, "exact-head validation passed");
  assert.equal(result.evidence[0]?.check, "CI");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evidence), true);
});

test("same focused evidence cannot satisfy held-out acceptance", () => {
  assert.throws(
    () => validateEvolutionValidationResult({
      ...valid(),
      heldOutEvidence: [{ check: "held-out/generalization", reference: "workflow:123", passed: true }],
    }),
    /EVOLVE_VALIDATION_HELD_OUT_REFERENCE_INVALID/,
  );
});

test("benefit-cost acceptance is deterministic and replayable", () => {
  const result = createEvolutionValidationResult(valid());
  assert.equal(result.benefitCostEvidence[0]?.netBenefitDelta, 1);
  assert.equal(isPromotionEligible(result), true);
  assert.throws(
    () => validateEvolutionValidationResult({
      ...valid(),
      benefitCostEvidence: [{ ...valid().benefitCostEvidence[0], netBenefitDelta: 2 }],
    }),
    /EVOLVE_VALIDATION_COST_EVIDENCE_NONDETERMINISTIC/,
  );
});

test("held-out evidence is an independent acceptance surface", () => {
  const result = createEvolutionValidationResult({
    ...valid(),
    heldOutEvidence: [{ check: "generalization-replay", reference: "heldout:2", passed: true }],
  });
  assert.equal(result.heldOutEvidence[0]?.reference, "heldout:2");
  assert.equal(isPromotionEligible(result), true);
});
