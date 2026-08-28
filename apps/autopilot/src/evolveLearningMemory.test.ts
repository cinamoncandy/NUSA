import { describe, expect, it } from "vitest";
import { createEvolutionLearningRecord } from "./evolveLearningMemory";

describe("evolve learning memory", () => {
  it("creates an immutable bounded record", () => {
    const record = createEvolutionLearningRecord({
      opportunityId: "opp:memory:1",
      problem: "Repeated validation regression",
      evidenceReferences: ["ci:123"],
      hypothesis: "A bounded fix removes the regression",
      changeReference: "pr:1013",
      validationStatus: "PASS",
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: "revert:1013",
      reusable: true,
      recordedAt: "2026-08-29T00:00:00.000Z",
    });
    expect(record.outcome).toBe("SUCCESS");
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.evidenceReferences)).toBe(true);
  });

  it("fails closed without evidence", () => {
    expect(() => createEvolutionLearningRecord({
      opportunityId: "opp:memory:2",
      problem: "Unknown regression",
      evidenceReferences: [],
      hypothesis: "Unknown",
      changeReference: "pr:1013",
      validationStatus: "INSUFFICIENT",
      outcome: "UNKNOWN",
      failureReason: "insufficient-evidence",
      rollbackReference: null,
      reusable: false,
      recordedAt: "2026-08-29T00:00:00.000Z",
    })).toThrow("EVOLVE_MEMORY_EVIDENCE_REQUIRED");
  });
});
