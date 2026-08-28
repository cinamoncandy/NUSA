import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCio, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";

const HASH = "a".repeat(64);

function binding(overrides: Partial<PaperCandidateExecutionBinding> = {}): PaperCandidateExecutionBinding {
  return {
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "candidate-a",
    datasetId: "dataset-a",
    datasetContentSha256: HASH,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: HASH,
    bindingFingerprintSha256: HASH,
    ...overrides,
  };
}

function decide(paperCandidateBinding?: PaperCandidateExecutionBinding) {
  return decideCio({
    symbol: "KRW-BTC",
    now: 3_000,
    signals: [{ source: "CHART", score: 0.8, confidence: 0.9, observedAt: 2_900, reason: "test signal" }],
    currentAllocation: 0,
    maxAllocation: 0.2,
    maxLeverage: 1,
    risk: "LOW",
    tradingEnabled: true,
    ...(paperCandidateBinding == null ? {} : { paperCandidateBinding }),
  });
}

describe("CIO PAPER candidate provenance transport", () => {
  it("carries an upstream BOUND_UNVERIFIED receipt without granting authority", () => {
    const decision = decide(binding());
    assert.equal(decision.paperCandidateBinding?.candidateId, "candidate-a");
    assert.equal(decision.paperCandidateBinding?.status, "BOUND_UNVERIFIED");
    assert.equal(decision.paperCandidateBinding?.liveAuthority, "NONE");
    assert.equal(decision.paperCandidateBinding?.productionMutationAllowed, false);
  });

  it("keeps ordinary unbound decisions unbound and therefore non-promotable", () => {
    const decision = decide();
    assert.equal(decision.paperCandidateBinding, undefined);
  });

  it("rejects generic CIO labels masquerading as candidate identity", () => {
    assert.throws(() => decide(binding({ candidateId: "CIO_PAPER" })), /candidateId is invalid/);
  });

  it("rejects lookahead and future-period candidate bindings", () => {
    assert.throws(() => decide(binding({ advisoryGeneratedAt: 2_000 })), /lookahead advisory provenance/);
    assert.throws(() => decide(binding({ periodStartAt: 3_001 })), /period starts after decision time/);
  });

  it("rejects malformed provenance fingerprints", () => {
    assert.throws(() => decide(binding({ bindingFingerprintSha256: "not-a-hash" })), /fingerprint is invalid/);
  });
});
