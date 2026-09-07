import assert from "node:assert/strict";
import test from "node:test";
import { createEvolutionLearningRecord } from "./evolveLearningMemory";
import { projectLearningMemoryToConfidence } from "./evolveLearningConfidenceBridge";

const record = (overrides: Partial<Parameters<typeof createEvolutionLearningRecord>[0]> = {}) => createEvolutionLearningRecord({
  opportunityId: "opp:bridge:1",
  problem: "Repeated regression",
  evidenceReferences: ["ci:run:bridge"],
  hypothesis: "A bounded change improves validation",
  changeReference: "pr:bridge",
  validationStatus: "VERIFIED_IMPROVEMENT",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: "revert:bridge",
  reusable: true,
  recordedAt: "2026-08-29T00:00:00.000Z",
  ...overrides,
});

const independentEvidence = [{
  id: "ci:run:bridge",
  source: "github.ci",
  quality: 0.95,
  independent: true,
}] as const;

test("verified reusable learning plus independent evidence may increase confidence", () => {
  const result = projectLearningMemoryToConfidence({
    record: record(),
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
    evidence: independentEvidence,
  });
  assert.equal(result.confidenceOutcome, "VERIFIED_IMPROVEMENT");
  assert.equal(result.decision.allowedConfidence, 0.7);
  assert.equal(result.reusableForConfidenceIncrease, true);
});

test("plain successful memory cannot manufacture verified improvement", () => {
  const result = projectLearningMemoryToConfidence({
    record: record({ validationStatus: "PASS" }),
    currentConfidence: 0.5,
    requestedConfidence: 0.8,
    evidence: independentEvidence,
  });
  assert.equal(result.confidenceOutcome, "INSUFFICIENT");
  assert.equal(result.decision.allowedConfidence, 0.5);
  assert.equal(result.reusableForConfidenceIncrease, false);
});

test("non-reusable memory cannot increase confidence", () => {
  const result = projectLearningMemoryToConfidence({
    record: record({ reusable: false }),
    currentConfidence: 0.4,
    requestedConfidence: 0.9,
    evidence: independentEvidence,
  });
  assert.equal(result.confidenceOutcome, "INSUFFICIENT");
  assert.equal(result.decision.allowedConfidence, 0.4);
});

test("regression and failure never increase confidence", () => {
  for (const outcome of ["REGRESSION", "FAILED"] as const) {
    const result = projectLearningMemoryToConfidence({
      record: record({ outcome }),
      currentConfidence: 0.6,
      requestedConfidence: 0.9,
      evidence: independentEvidence,
    });
    assert.equal(result.confidenceOutcome, outcome);
    assert.equal(result.decision.allowedConfidence, 0.6);
    assert.equal(result.decision.increased, false);
  }
});

test("memory evidence must be explicitly linked to confidence evidence", () => {
  assert.throws(() => projectLearningMemoryToConfidence({
    record: record({ evidenceReferences: ["ci:missing"] }),
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
    evidence: independentEvidence,
  }), /EVOLVE_LEARNING_CONFIDENCE_EVIDENCE_MISMATCH/);
});

test("bridge preserves zero authority", () => {
  const result = projectLearningMemoryToConfidence({
    record: record(),
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
    evidence: independentEvidence,
  });
  assert.deepEqual(result.decision.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});
