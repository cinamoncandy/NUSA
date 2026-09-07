import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createResearchHypothesis,
  type ResearchHypothesis,
} from "../../../../packages/contracts/src/researchHypothesisContract";
import {
  admitCanonicalResearchHypothesis,
  ResearchHypothesisAdmissionError,
} from "./researchHypothesisAdmission";

const SNAPSHOT = Date.parse("2026-08-31T00:00:00.000Z");
const manifest = {
  datasetId: "upbit-KRW-BTC-1d-20260830",
  contentSha256: "b".repeat(64),
  market: "KRW-BTC",
} as const;

function hypothesis(overrides: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
  return createResearchHypothesis({
    hypothesisId: "run-hypothesis:candidate-1",
    candidateId: "candidate-1",
    family: "MOMENTUM",
    rationale: "A precommitted directional persistence claim.",
    mechanism: "Delayed liquidity replenishment can preserve short-lived order-flow pressure.",
    targetMarket: "KRW-BTC",
    expectedRegime: "UNKNOWN",
    invalidationCondition: "The cost-adjusted out-of-sample effect is not reproducible.",
    holdingPeriodMs: 86_400_000,
    capacityAssumptions: { maxNotional: 10_000_000, maxParticipationRate: 0.05 },
    transactionCostSensitivity: 1,
    provenance: { author: "research-run", sourceReferences: ["dataset:upbit-KRW-BTC-1d-20260830"] },
    createdAt: new Date(SNAPSHOT).toISOString(),
    ...overrides,
  });
}

function admit(value: unknown = hypothesis()) {
  return admitCanonicalResearchHypothesis({
    hypothesis: value,
    candidateId: "candidate-1",
    manifest,
    expectedCreatedAt: new Date(SNAPSHOT).toISOString(),
    evaluationGeneratedAt: new Date(SNAPSHOT + 4).toISOString(),
  });
}

describe("canonical research hypothesis admission", () => {
  it("binds an immutable hypothesis to candidate, dataset market, and run chronology", () => {
    const result = admit();
    assert.equal(result.candidateId, "candidate-1");
    assert.equal(result.datasetId, manifest.datasetId);
    assert.equal(result.datasetContentSha256, manifest.contentSha256);
    assert.match(result.hypothesisHash, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.hypothesis));
    assert.ok(Object.isFrozen(result.hypothesis.provenance));
    assert.ok(Object.isFrozen(result.hypothesis.provenance.sourceReferences));
  });

  it("normalizes semantically unordered references deterministically", () => {
    const first = admit(hypothesis({ provenance: { author: "research-run", sourceReferences: ["z", "a"] } }));
    const second = admit(hypothesis({ provenance: { author: "research-run", sourceReferences: ["a", "z"] } }));
    assert.deepEqual(first.hypothesis, second.hypothesis);
    assert.equal(first.hypothesisHash, second.hypothesisHash);
  });

  it("rejects missing canonical evidence instead of manufacturing a default", () => {
    assert.throws(
      () => admit(null),
      (error) => error instanceof ResearchHypothesisAdmissionError && error.code === "INVALID_CANONICAL_HYPOTHESIS",
    );
  });

  it("rejects candidate, market, and precommitment drift", () => {
    assert.throws(() => admit(hypothesis({ candidateId: "candidate-2" })), /hypothesis candidate/);
    assert.throws(() => admit(hypothesis({ targetMarket: "BTC-USD" })), /hypothesis market/);
    assert.throws(() => admit(hypothesis({ createdAt: new Date(SNAPSHOT + 1).toISOString() })), /precommit/);
  });

  it("rejects forbidden fields before hashing the hypothesis", () => {
    const unsafe = { ...hypothesis(), ["api" + "Token"]: "not-persisted" };
    assert.throws(
      () => admit(unsafe),
      (error) => error instanceof ResearchHypothesisAdmissionError && error.code === "FORBIDDEN_HYPOTHESIS_FIELD",
    );
  });

  it("rejects malformed dataset provenance", () => {
    assert.throws(
      () => admitCanonicalResearchHypothesis({
        hypothesis: hypothesis(),
        candidateId: "candidate-1",
        manifest: { ...manifest, contentSha256: "invalid" },
        expectedCreatedAt: new Date(SNAPSHOT).toISOString(),
        evaluationGeneratedAt: new Date(SNAPSHOT + 4).toISOString(),
      }),
      (error) => error instanceof ResearchHypothesisAdmissionError && error.code === "INVALID_DATASET_BINDING",
    );
  });
});
