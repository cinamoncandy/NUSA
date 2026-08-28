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
