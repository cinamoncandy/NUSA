import assert from "node:assert/strict";
import test from "node:test";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { buildPaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";
import {
  buildPaperCompletedExecutionCostEvidence,
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
    quantity: 2,
    price: 101.5,
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

function quote(observedAt = 3_900) {
  return buildPaperOrderBookQuoteReceipt({
    type: "orderbook",
    code: "KRW-BTC",
    total_ask_size: 10,
    total_bid_size: 10,
    orderbook_units: [
      { ask_price: 101, bid_price: 99, ask_size: 5, bid_size: 5 },
      { ask_price: 102, bid_price: 98, ask_size: 5, bid_size: 5 },
    ],
  }, observedAt);
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
  assert.equal(evidence.fillPrice, 101.5);
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

test("derives complete observed spread and slippage only from the quote receipt and exact fill", () => {
  const evidence = buildPaperCompletedExecutionCostEvidence(fill(), quote(), 500);
  assert.equal(evidence.completeness, "COMPLETE");
  assert.equal(evidence.evidenceKind, "OBSERVED");
  assert.equal(evidence.candidateId, "candidate-alpha");
  assert.equal(evidence.quotePrice, 101);
  assert.equal(evidence.fillPrice, 101.5);
  assert.equal(evidence.spreadAmount, 2);
  assert.equal(evidence.slippageAmount, 1);
  assert.equal(evidence.quoteReceiptFingerprintSha256, quote().fingerprintSha256);
  assert.match(evidence.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
});

test("sell-side cost attribution uses observed bid touch and refuses to invent negative slippage", () => {
  const evidence = buildPaperCompletedExecutionCostEvidence(fill({ side: "SELL", price: 99.5 }), quote(), 500);
  assert.equal(evidence.quotePrice, 99);
  assert.equal(evidence.spreadAmount, 2);
  assert.equal(evidence.slippageAmount, 0);
});

test("complete evidence fails closed on stale, future, or wrong-market quote receipts", () => {
  assert.equal(errorCode(() => buildPaperCompletedExecutionCostEvidence(fill(), quote(3_000), 500)), "STALE_QUOTE");
  assert.equal(errorCode(() => buildPaperCompletedExecutionCostEvidence(fill(), quote(4_001), 500)), "FUTURE_QUOTE");
  const wrongMarket = buildPaperOrderBookQuoteReceipt({
    type: "orderbook",
    code: "KRW-ETH",
    total_ask_size: 1,
    total_bid_size: 1,
    orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 1 }],
  }, 3_900);
  assert.equal(errorCode(() => buildPaperCompletedExecutionCostEvidence(fill(), wrongMarket, 500)), "QUOTE_MARKET_MISMATCH");
});

test("complete evidence identity changes when immutable quote provenance changes", () => {
  const first = buildPaperCompletedExecutionCostEvidence(fill(), quote(3_900), 500);
  const second = buildPaperCompletedExecutionCostEvidence(fill(), quote(3_901), 500);
  assert.notEqual(first.evidenceFingerprintSha256, second.evidenceFingerprintSha256);
  assert.notEqual(first.quoteReceiptFingerprintSha256, second.quoteReceiptFingerprintSha256);
});

test("unbound fills cannot manufacture candidate-specific cost evidence", () => {
  const unbound = fill({ candidateProvenance: undefined });
  assert.equal(errorCode(() => buildPaperRuntimeExecutionCostEvidence(unbound, 100)), "MISSING_CANDIDATE_PROVENANCE");
  assert.equal(errorCode(() => buildPaperCompletedExecutionCostEvidence(unbound, quote(), 500)), "MISSING_CANDIDATE_PROVENANCE");
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
  assert.equal(errorCode(() => buildPaperCompletedExecutionCostEvidence(corrupted, quote(), 500)), "INVALID_CANDIDATE_PROVENANCE");
});

test("invalid quote prices cannot become observed evidence", () => {
  assert.equal(errorCode(() => buildPaperRuntimeExecutionCostEvidence(fill(), 0)), "INVALID_EXECUTION_PRICE");
});
