import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAiHypothesisDraft,
  completeAiHypothesisDraft,
  AiHypothesisContractInvalidError,
} from "./researchHypothesisAgent";
import type { ResearchHypothesis } from "../../../../packages/contracts/src/researchHypothesisContract";

function validHypothesis(overrides: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: "hyp-1",
    candidateId: "cand-1",
    family: "MOMENTUM",
    rationale: "Short-term order flow imbalance tends to persist for a few minutes on this market.",
    mechanism: "Slow liquidity replenishment after large aggressive orders creates temporary directional drift.",
    targetMarket: "BTC-USD",
    expectedRegime: "TREND_UP",
    invalidationCondition: "Order flow imbalance no longer predicts 5-minute forward return with p<0.05.",
    holdingPeriodMs: 15 * 60 * 1000,
    capacityAssumptions: { maxNotional: 50_000, maxParticipationRate: 0.05 },
    transactionCostSensitivity: 0.6,
    provenance: { author: "ai-zero-authority", sourceReferences: ["dataset:btc-orderflow-2026"] },
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("createAiHypothesisDraft (existing thin draft)", () => {
  it("still creates a DRAFT hypothesis record", () => {
    const record = createAiHypothesisDraft({
      recordId: "rec-1",
      researchId: "research-1",
      question: "Does order flow predict short-term return?",
      hypothesis: "Order flow imbalance predicts 5-minute forward return.",
      evidenceReferences: ["dataset:btc-orderflow-2026"],
      modelVersionId: "model-v3",
      promptArtifactDigest: "sha256:abc",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    assert.equal(record.stage, "HYPOTHESIS");
    assert.equal(record.payload.lifecycle, "DRAFT");
  });
});

describe("completeAiHypothesisDraft", () => {
  it("wraps a fully valid ResearchHypothesis into a HYPOTHESIS-stage memory record", () => {
    const hypothesis = validHypothesis();
    const record = completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis });
    assert.equal(record.stage, "HYPOTHESIS");
    assert.equal(record.author, "ai-zero-authority");
    assert.equal(record.summary, hypothesis.rationale);
    assert.deepEqual(record.payload.hypothesis, hypothesis);
    assert.equal(record.payload.lifecycle, "DRAFT");
    assert.equal(record.payload.promotionAllowed, false);
    assert.equal(record.payload.productionMutationAllowed, false);
  });

  it("throws AiHypothesisContractInvalidError and creates no record for an invalid hypothesis", () => {
    const invalid = { ...validHypothesis(), invalidationCondition: "" };
    assert.throws(
      () => completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis: invalid as ResearchHypothesis }),
      (error: unknown) => {
        assert.ok(error instanceof AiHypothesisContractInvalidError);
        assert.ok(error.errors.includes("INVALIDATION_CONDITION_INVALID"));
        return true;
      },
    );
  });

  it("rejects a hypothesis with an unrecognized family before creating a record", () => {
    const invalid = { ...validHypothesis(), family: "ASTROLOGY" };
    assert.throws(() =>
      completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis: invalid as unknown as ResearchHypothesis }),
    );
  });

  it("uses the hypothesis's own createdAt, not a caller-supplied one", () => {
    const hypothesis = validHypothesis({ createdAt: "2026-08-30T12:00:00.000Z" });
    const record = completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis });
    assert.equal(record.createdAt, "2026-08-30T12:00:00.000Z");
  });

  it("produces a deterministic content hash for identical input", () => {
    const hypothesis = validHypothesis();
    const first = completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis });
    const second = completeAiHypothesisDraft({ recordId: "rec-1", researchId: "research-1", hypothesis });
    assert.equal(first.contentHash, second.contentHash);
  });
});
