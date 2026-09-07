import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvolutionLearningRecord } from "./evolveLearningMemory";

test("evolve learning memory creates an immutable bounded record", () => {
  const record = createEvolutionLearningRecord({
    opportunityId: "opp:memory:1",
    problem: "Repeated validation regression",
    evidenceReferences: ["ci:123"],
    hypothesis: "A bounded fix removes the regression",
    changeReference: "pr:1014",
    validationStatus: "PASS",
    outcome: "SUCCESS",
    failureReason: null,
    rollbackReference: "revert:1014",
    reusable: true,
    recordedAt: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(record.outcome, "SUCCESS");
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.evidenceReferences), true);
});

test("evolve learning memory fails closed without evidence", () => {
  assert.throws(() => createEvolutionLearningRecord({
    opportunityId: "opp:memory:2",
    problem: "Unknown regression",
    evidenceReferences: [],
    hypothesis: "Unknown",
    changeReference: "pr:1014",
    validationStatus: "INSUFFICIENT",
    outcome: "UNKNOWN",
    failureReason: "insufficient-evidence",
    rollbackReference: null,
    reusable: false,
    recordedAt: "2026-08-29T00:00:00.000Z",
  }), /EVOLVE_MEMORY_EVIDENCE_REQUIRED/);
});

test("evolve learning memory rejects malformed runtime enum and flag values", () => {
  const valid = {
    opportunityId: "opp:memory:3",
    problem: "Malformed runtime input",
    evidenceReferences: ["ci:456"],
    hypothesis: "Reject unknown values",
    changeReference: "pr:1015",
    validationStatus: "UNKNOWN",
    outcome: "NOT_A_CANONICAL_OUTCOME" as never,
    failureReason: null,
    rollbackReference: null,
    reusable: true,
    recordedAt: "2026-08-29T00:00:00.000Z",
  };
  assert.throws(() => createEvolutionLearningRecord(valid), /EVOLVE_MEMORY_OUTCOME_INVALID/);
  assert.throws(() => createEvolutionLearningRecord({ ...valid, outcome: "UNKNOWN", reusable: "true" as never }), /EVOLVE_MEMORY_REUSABLE_INVALID/);
});
