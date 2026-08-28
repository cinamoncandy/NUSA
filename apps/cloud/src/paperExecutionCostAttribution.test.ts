import assert from "node:assert/strict";
import test from "node:test";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { buildPaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";
import {
  bindPaperExecutionCostAttribution,
  validatePersistedPaperExecutionCostAttribution,
} from "./paperExecutionCostAttribution";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";
import type { UpbitOrderBook } from "./upbitWebSocket";

const binding: PaperCandidateExecutionBinding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "candidate-alpha",
  datasetId: "dataset-alpha",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 900,
  periodStartAt: 925,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
});

const fill: PaperFillRecord = Object.freeze({
  id: "fill:alpha",
  orderId: "order:alpha",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 2,
  price: 101,
  fee: 0.1,
  filledAt: 1_000,
  candidateProvenance: Object.freeze({
    schemaVersion: 1,
    source: "CIO_DECISION_BINDING",
    decisionAt: 950,
    binding,
  }),
});

const orderBook: UpbitOrderBook = Object.freeze({
  type: "orderbook",
  code: "KRW-BTC",
  total_ask_size: 3,
  total_bid_size: 4,
  orderbook_units: Object.freeze([
    Object.freeze({ ask_price: 100, bid_price: 98, ask_size: 1, bid_size: 1 }),
    Object.freeze({ ask_price: 102, bid_price: 97, ask_size: 2, bid_size: 3 }),
  ]),
});

const receipt = buildPaperOrderBookQuoteReceipt(orderBook, 990);

test("binds immutable quote provenance and observed attribution to the exact fill", () => {
  const attributed = bindPaperExecutionCostAttribution(fill, receipt, 30_000);
  assert.equal(attributed.orderBookQuoteReceipt.fingerprintSha256, receipt.fingerprintSha256);
  assert.equal(attributed.executionCostAttribution.candidateId, "candidate-alpha");
  assert.equal(attributed.executionCostAttribution.quotePrice, 100);
  assert.equal(attributed.executionCostAttribution.spreadAmount, 2);
  assert.equal(attributed.executionCostAttribution.slippageAmount, 2);
  assert.equal(attributed.executionCostAttribution.feeAmount, fill.fee);
});

test("revalidates persisted attribution deterministically after restart", () => {
  const attributed = bindPaperExecutionCostAttribution(fill, receipt, 30_000);
  assert.deepEqual(validatePersistedPaperExecutionCostAttribution(attributed, 30_000), attributed);
});

test("rejects tampered persisted attribution", () => {
  const attributed = bindPaperExecutionCostAttribution(fill, receipt, 30_000);
  const tampered = Object.freeze({
    ...attributed,
    executionCostAttribution: Object.freeze({ ...attributed.executionCostAttribution, slippageAmount: 0 }),
  });
  assert.throws(() => validatePersistedPaperExecutionCostAttribution(tampered, 30_000), /does not match|mismatch/i);
});

test("fails closed when canonical candidate provenance is missing", () => {
  const { candidateProvenance: _candidateProvenance, ...withoutCandidate } = fill;
  assert.throws(
    () => bindPaperExecutionCostAttribution(Object.freeze(withoutCandidate), receipt, 30_000),
    /candidate provenance/i,
  );
});
