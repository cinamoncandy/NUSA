import assert from "node:assert/strict";
import test from "node:test";
import type { PaperCalibrationLearningDecision } from "./evolvePaperCalibrationDecision";
import { decidePaperCalibratedEvolutionPromotion } from "./evolvePromotion";
import { createEvolutionValidationResult } from "./evolveValidation";

const head = "a".repeat(40);

function validation(status: "PASS" | "FAIL" | "INSUFFICIENT" | "ABSTAIN" = "PASS") {
  return createEvolutionValidationResult({
    opportunityId: "opportunity:paper-calibration",
    status,
    exactHeadSha: head,
    evidence: [{ check: "exact-head", reference: `commit:${head}`, passed: status === "PASS" }],
    reason: `validation:${status.toLowerCase()}`,
  });
}

function calibration(
  comparisonStatus: PaperCalibrationLearningDecision["comparisonStatus"],
  action: PaperCalibrationLearningDecision["action"],
  eligible: boolean,
): PaperCalibrationLearningDecision {
  return Object.freeze({
    comparisonStatus,
    action,
    calibrationEligible: eligible,
    confidenceIncreaseEligible: eligible,
    reasons: Object.freeze(["test-evidence"]),
    authority: Object.freeze({
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
  });
}

test("INSUFFICIENT PAPER evidence cannot promote even with validation PASS", () => {
  const decision = decidePaperCalibratedEvolutionPromotion(
    validation("PASS"),
    "main",
    calibration("INSUFFICIENT", "HOLD", false),
  );

  assert.equal(decision.eligible, false);
  assert.equal(decision.exactHeadSha, head);
  assert.match(decision.reason, /^blocked:paper-calibration:insufficient:hold$/);
});

test("REGRESSION PAPER evidence deterministically blocks promotion", () => {
  const decision = decidePaperCalibratedEvolutionPromotion(
    validation("PASS"),
    "main",
    calibration("REGRESSION", "DEMOTE", false),
  );

  assert.equal(decision.eligible, false);
  assert.match(decision.reason, /^blocked:paper-calibration:regression:demote$/);
});

test("VERIFIED_IMPROVEMENT promotes only with explicit calibration eligibility", () => {
  const blocked = decidePaperCalibratedEvolutionPromotion(
    validation("PASS"),
    "main",
    calibration("VERIFIED_IMPROVEMENT", "HOLD", false),
  );
  assert.equal(blocked.eligible, false);

  const allowed = decidePaperCalibratedEvolutionPromotion(
    validation("PASS"),
    "main",
    calibration("VERIFIED_IMPROVEMENT", "CONFIDENCE_INCREASE_ELIGIBLE", true),
  );
  assert.equal(allowed.eligible, true);
  assert.equal(allowed.reason, "validated:main:paper-calibration-verified");
});

test("calibration evidence never overrides a failed exact-head validation gate", () => {
  const decision = decidePaperCalibratedEvolutionPromotion(
    validation("FAIL"),
    "main",
    calibration("VERIFIED_IMPROVEMENT", "CONFIDENCE_INCREASE_ELIGIBLE", true),
  );

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "blocked:fail");
});
