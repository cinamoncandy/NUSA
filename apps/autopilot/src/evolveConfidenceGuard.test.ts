import assert from "node:assert/strict";
import test from "node:test";
import { guardEvolutionConfidence } from "./evolveConfidenceGuard";

const evidence = (overrides: Record<string, unknown> = {}) => ({
  id: "ci:run:123",
  source: "github.ci",
  quality: 0.9,
  independent: true,
  ...overrides,
});

test("allows confidence increase only with independent verified evidence", () => {
  const result = guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.7,
    outcome: "VERIFIED_IMPROVEMENT",
    evidence: [evidence()],
  });
  assert.equal(result.allowedConfidence, 0.7);
  assert.equal(result.increased, true);
  assert.equal(result.reason, "INDEPENDENT_VERIFIED_EVIDENCE");
});

test("blocks selection-as-evidence and insufficient evidence from increasing confidence", () => {
  const selectedOnly = guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.8,
    outcome: "VERIFIED_IMPROVEMENT",
    evidence: [evidence({ independent: false })],
  });
  assert.equal(selectedOnly.allowedConfidence, 0.5);
  assert.equal(selectedOnly.reason, "INSUFFICIENT_EVIDENCE");

  const insufficient = guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.8,
    outcome: "INSUFFICIENT",
    evidence: [evidence()],
  });
  assert.equal(insufficient.allowedConfidence, 0.5);
});

test("never increases confidence after regression or failure", () => {
  for (const outcome of ["REGRESSION", "FAILED"] as const) {
    const result = guardEvolutionConfidence({
      currentConfidence: 0.6,
      requestedConfidence: 0.9,
      outcome,
      evidence: [evidence()],
    });
    assert.equal(result.allowedConfidence, 0.6);
    assert.equal(result.increased, false);
    assert.equal(result.reason, "NEGATIVE_OUTCOME");
  }
});

test("permits evidence-backed decreases without inventing a confidence penalty", () => {
  const result = guardEvolutionConfidence({
    currentConfidence: 0.7,
    requestedConfidence: 0.4,
    outcome: "REGRESSION",
    evidence: [evidence()],
  });
  assert.equal(result.allowedConfidence, 0.4);
  assert.equal(result.reason, "NEGATIVE_OUTCOME");
});

test("rejects malformed evidence and preserves zero authority", () => {
  assert.throws(() => guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.6,
    outcome: "VERIFIED_IMPROVEMENT",
    evidence: [evidence({ quality: 1.1 })],
  }), /EVOLVE_CONFIDENCE_EVIDENCE_QUALITY_INVALID/);

  assert.throws(() => guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.6,
    outcome: "VERIFIED_IMPROVEMENT",
    evidence: [evidence({ independent: "false" as never })],
  }), /EVOLVE_CONFIDENCE_EVIDENCE_INVALID/);

  const result = guardEvolutionConfidence({
    currentConfidence: 0.5,
    requestedConfidence: 0.5,
    outcome: "INSUFFICIENT",
    evidence: [],
  });
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});
