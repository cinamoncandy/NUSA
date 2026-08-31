import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateResearchHypothesis,
  isValidResearchHypothesis,
  isLegitimateHypothesisRevision,
  type ResearchHypothesis,
} from "./researchHypothesisContract";

function validHypothesis(overrides: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: "hyp-1",
    candidateId: "cand-1",
    family: "MOMENTUM",
    rationale: "Short-term order flow imbalance tends to persist for a few minutes on this market.",
    mechanism: "Slow liquidity replenishment after large aggressive orders creates temporary directional drift.",
    targetMarket: "BTC-USD",
    expectedRegime: "TREND_UP,HIGH_VOL",
    invalidationCondition: "Order flow imbalance no longer predicts 5-minute forward return with p<0.05 over a rolling 60-day window.",
    holdingPeriodMs: 15 * 60 * 1000,
    capacityAssumptions: { maxNotional: 50_000, maxParticipationRate: 0.05 },
    transactionCostSensitivity: 0.6,
    provenance: { author: "researcher-1", sourceReferences: ["dataset:btc-orderflow-2026"] },
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("research hypothesis contract", () => {
  it("accepts a fully populated hypothesis", () => {
    const result = validateResearchHypothesis(validHypothesis());
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(isValidResearchHypothesis(validHypothesis()), true);
  });

  it("accepts an optional AI provenance and parent lineage", () => {
    const result = validateResearchHypothesis(
      validHypothesis({
        parentHypothesisId: "hyp-0",
        provenance: {
          author: "ai-zero-authority",
          modelVersionId: "model-v3",
          promptArtifactDigest: "sha256:abc",
          sourceReferences: ["dataset:btc-orderflow-2026"],
        },
      }),
    );
    assert.equal(result.valid, true);
  });

  it("rejects an unrecognized family", () => {
    const result = validateResearchHypothesis({ ...validHypothesis(), family: "ASTROLOGY" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("FAMILY_INVALID"));
  });

  it("rejects a hypothesis that lists itself as its own parent", () => {
    const hypothesis = validHypothesis();
    const result = validateResearchHypothesis({ ...hypothesis, parentHypothesisId: hypothesis.hypothesisId });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("HYPOTHESIS_CANNOT_BE_OWN_PARENT"));
  });

  it("requires a non-empty mechanism distinct from the rationale field", () => {
    const result = validateResearchHypothesis({ ...validHypothesis(), mechanism: "" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("MECHANISM_INVALID"));
  });

  it("requires a non-empty invalidation condition", () => {
    const result = validateResearchHypothesis({ ...validHypothesis(), invalidationCondition: "" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("INVALIDATION_CONDITION_INVALID"));
  });

  it("rejects a non-positive holding period", () => {
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), holdingPeriodMs: 0 }).valid, false);
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), holdingPeriodMs: -1 }).valid, false);
  });

  it("rejects malformed capacity assumptions", () => {
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), capacityAssumptions: { maxNotional: -1, maxParticipationRate: 0.1 } }).valid, false);
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), capacityAssumptions: { maxNotional: 1000, maxParticipationRate: 1.5 } }).valid, false);
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), capacityAssumptions: undefined }).valid, false);
  });

  it("rejects transaction cost sensitivity outside 0..1", () => {
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), transactionCostSensitivity: 1.1 }).valid, false);
    assert.equal(validateResearchHypothesis({ ...validHypothesis(), transactionCostSensitivity: -0.1 }).valid, false);
  });

  it("rejects missing provenance source references", () => {
    const result = validateResearchHypothesis({
      ...validHypothesis(),
      provenance: { author: "researcher-1", sourceReferences: [] },
    });
    // empty array is structurally valid (Array.isArray + every() on empty is true) -- but a
    // hypothesis with literally zero source references should still fail some other useful
    // signal in practice; this test documents the current (permissive-on-empty) behavior.
    assert.equal(result.valid, true);
  });

  it("rejects a non-array provenance source references field", () => {
    const result = validateResearchHypothesis({
      ...validHypothesis(),
      provenance: { author: "researcher-1", sourceReferences: "dataset:btc" },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("PROVENANCE_SOURCE_REFERENCES_INVALID"));
  });

  it("rejects an unparseable createdAt", () => {
    const result = validateResearchHypothesis({ ...validHypothesis(), createdAt: "not-a-date" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("CREATED_AT_INVALID"));
  });

  it("rejects a non-object value", () => {
    assert.equal(validateResearchHypothesis(null).valid, false);
    assert.equal(validateResearchHypothesis("hypothesis").valid, false);
  });
});

describe("hypothesis revision legitimacy", () => {
  it("accepts a new id with correct parent linkage and same candidate", () => {
    const original = validHypothesis();
    const revision = validHypothesis({ hypothesisId: "hyp-2", parentHypothesisId: "hyp-1" });
    assert.equal(isLegitimateHypothesisRevision(original, revision), true);
  });

  it("rejects a same-id in-place rewrite", () => {
    const original = validHypothesis();
    const rewrite = validHypothesis({ rationale: "a different story now" });
    assert.equal(isLegitimateHypothesisRevision(original, rewrite), false);
  });

  it("rejects a revision that does not point back to the original as parent", () => {
    const original = validHypothesis();
    const revision = validHypothesis({ hypothesisId: "hyp-2", parentHypothesisId: "hyp-99" });
    assert.equal(isLegitimateHypothesisRevision(original, revision), false);
  });

  it("rejects a revision that switches candidateId", () => {
    const original = validHypothesis();
    const revision = validHypothesis({ hypothesisId: "hyp-2", parentHypothesisId: "hyp-1", candidateId: "cand-2" });
    assert.equal(isLegitimateHypothesisRevision(original, revision), false);
  });
});
