import assert from "node:assert/strict";
import test from "node:test";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import {
  buildPaperRuntimeExecutionCostEvidence,
  PaperRuntimeExecutionCostEvidenceError,
} from "./paperRuntimeExecutionCostEvidence";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function binding(): PaperCandidateExecutionBinding {
  return Object.freeze({
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "candidate-alpha",
    datasetId: "dataset-2026-08-28",
    datasetContentSha256: SHA_A,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: SHA_B,
    bindingFingerprintSha256: SHA_C,
  });
}

function fill(overrides: Partial<PaperFillRecord> = {}): PaperFillRecord {
  return {
    id: "fill-1",
    orderId: "order-1",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 1,
    price: 100,
    fee: 0.05,
    filledAt: 4_000,
    candidateProvenance: {
      schemaVersion: 1,
      source: "CIO_DECISION_BINDING",
      decisionAt: 3_000,
      binding: binding(),
    },
    ...overrides,
  };
}

function errorCode(fn: () => unknown): string {
  try { fn(); } catch (error) {
    if (error instanceof PaperRuntimeExecutionCostEvidenceError) return error.code;
    throw error;
  }
  throw new Error("expected PaperRuntimeExecutionCostEvidenceError");
}

test("captures only observed PAPER fill price and fee while preserving unknown friction", () => {
  const evidence = buildPaperRuntimeExecutionCostEvidence(fill(), 100);
  assert.equal(evidence.source, "PAPER_EXECUTION_BOUNDARY");
  assert.equal(evidence.evidenceKind, "OBSERVED");
  assert.equal(evidence.completeness, "INCOMPLETE");
  assert.equal(evidence.candidateId, "candidate-alpha");
  assert.equal(evidence.quotePrice, 100);
  assert.equal(evidence.fillPrice, 100);
  assert.equal(evidence.feeAmount, 0.05);
  assert.equal(evidence.spreadAmount, null);
  assert.equal(evidence.slippageAmount, null);
  assert.match(evidence.evidenceId, /^paper-cost:fill-1:[a-f0-9]{24}$/);
  assert.match(evidence.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
});

test("runtime evidence identity is deterministic for the same canonical facts", () => {
  const left = buildPaperRuntimeExecutionCostEvidence(fill(), 100);
  const right = buildPaperRuntimeExecutionCostEvidence(fill(), 100);
  assert.deepEqual(left, right);
});

test("unbound fills cannot manufacture candidate-specific cost evidence", () => {
  const unbound = fill({ candidateProvenance: undefined });
  assert.equal(errorCode(() => buildPaperRuntimeExecutionCostEvidence(unbound, 100)), "MISSING_CANDIDATE_PROVENANCE");
});

test("generic or corrupted candidate provenance is rejected fail closed", () => {
  const corrupted = fill({
    candidateProvenance: {
      schemaVersion: 1,
      source: "CIO_DECISION_BINDING",
      decisionAt: 3_000,
      binding: { ...binding(), candidateId: "CIO_PAPER" },
    },
  });
  assert.equal(errorCode(() => buildPaperRuntimeExecutionCostEvidence(corrupted, 100)), "INVALID_CANDIDATE_PROVENANCE");
});

test("invalid quote prices cannot become observed evidence", () => {
  assert.equal(errorCode(() => buildPaperRuntimeExecutionCostEvidence(fill(), 0)), "INVALID_EXECUTION_PRICE");
});
