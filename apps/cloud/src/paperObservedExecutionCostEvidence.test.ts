import assert from "node:assert/strict";
import test from "node:test";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import {
  buildPaperObservedExecutionCostAttribution,
  buildPaperObservedExecutionQuote,
  PaperRuntimeExecutionCostEvidenceError,
  validatePaperObservedExecutionCostAttribution,
  type PaperObservedExecutionCostFillInput,
} from "./paperRuntimeExecutionCostEvidence";

const HASH = "a".repeat(64);
const binding = (): PaperCandidateExecutionBinding => ({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "candidate-observed",
  datasetId: "dataset-observed",
  datasetContentSha256: HASH,
  advisoryGeneratedAt: 1_000,
  periodStartAt: 2_000,
  advisoryFingerprintSha256: HASH,
  bindingFingerprintSha256: HASH,
});

const fill = (overrides: Partial<PaperObservedExecutionCostFillInput> = {}): PaperObservedExecutionCostFillInput => ({
  id: "fill-observed",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 2,
  price: 102,
  fee: 0.1,
  filledAt: 4_000,
  candidateProvenance: { schemaVersion: 1, source: "CIO_DECISION_BINDING", decisionAt: 3_000, binding: binding() },
  ...overrides,
});

function code(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperRuntimeExecutionCostEvidenceError) return error.code;
    throw error;
  }
  throw new Error("expected PaperRuntimeExecutionCostEvidenceError");
}

test("observed public orderbook completes candidate-specific PAPER cost attribution", () => {
  const quote = buildPaperObservedExecutionQuote({
    market: "krw-btc",
    observedAt: 3_900,
    totalAskSize: 20,
    totalBidSize: 20,
    units: [
      { askPrice: 101, bidPrice: 99, askSize: 10, bidSize: 10 },
      { askPrice: 102, bidPrice: 98, askSize: 10, bidSize: 10 },
    ],
  });
  const attribution = buildPaperObservedExecutionCostAttribution(fill(), quote);
  assert.equal(quote.bidPrice, 99);
  assert.equal(quote.askPrice, 101);
  assert.equal(attribution.quotePrice, 101);
  assert.equal(attribution.spreadAmount, 2);
  assert.equal(attribution.slippageAmount, 2);
  assert.equal(attribution.quoteEvidenceId, quote.evidenceId);
  assert.equal(attribution.quoteObservedAt, 3_900);
  assert.match(attribution.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validatePaperObservedExecutionCostAttribution(fill(), quote, attribution), attribution);
  assert.deepEqual(buildPaperObservedExecutionCostAttribution(fill(), quote), attribution);
});

test("stale, crossed, and tampered public quote evidence fail closed", () => {
  const quote = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 1_000,
    totalAskSize: 1,
    totalBidSize: 1,
    units: [{ askPrice: 101, bidPrice: 99, askSize: 1, bidSize: 1 }],
  });
  assert.equal(code(() => buildPaperObservedExecutionCostAttribution(fill({ filledAt: 7_000 }), quote)), "STALE_QUOTE");
  assert.equal(code(() => buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 3_000,
    totalAskSize: 1,
    totalBidSize: 1,
    units: [{ askPrice: 98, bidPrice: 99, askSize: 1, bidSize: 1 }],
  })), "CROSSED_ORDERBOOK");
  const fresh = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 3_900,
    totalAskSize: 1,
    totalBidSize: 1,
    units: [{ askPrice: 101, bidPrice: 99, askSize: 1, bidSize: 1 }],
  });
  const attribution = buildPaperObservedExecutionCostAttribution(fill(), fresh);
  assert.equal(code(() => validatePaperObservedExecutionCostAttribution(fill(), fresh, { ...attribution, slippageAmount: 0 })), "OBSERVED_COST_ATTRIBUTION_MISMATCH");
});
