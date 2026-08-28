import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";
import {
  PaperCanonicalOutcomeReconciliationError,
  reconcileCanonicalPaperOutcomeWindow,
  type PaperExecutionCostAttribution,
} from "./paperCanonicalOutcomeReconciliation";

const START = 1_000;
const END = 2_000;

const baseState = (updatedAt: number, equity: number, fills: readonly PaperFillRecord[] = []): PaperAccountState => Object.freeze({
  version: 1,
  initialCapital: 1_000,
  cash: equity,
  equity,
  realizedPnL: 0,
  unrealizedPnL: 0,
  positions: Object.freeze([]),
  orders: Object.freeze([]),
  fills: Object.freeze([...fills]),
  processedIdempotencyKeys: Object.freeze([]),
  updatedAt,
});

const attribution = (overrides: Partial<PaperExecutionCostAttribution> = {}): PaperExecutionCostAttribution => Object.freeze({
  schemaVersion: 1,
  source: "PAPER_EXECUTION_BOUNDARY",
  candidateId: "candidate-a",
  quotePrice: 100,
  fillPrice: 100,
  feeAmount: 0.05,
  spreadAmount: 0,
  slippageAmount: 0,
  ...overrides,
});

const fill = (overrides: Partial<PaperFillRecord & { executionCostAttribution: PaperExecutionCostAttribution }> = {}): PaperFillRecord => ({
  id: "fill-1",
  orderId: "order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 1,
  price: 100,
  fee: 0.05,
  filledAt: 1_500,
  executionCostAttribution: attribution(),
  ...overrides,
} as PaperFillRecord);

const code = (fn: () => unknown): string => {
  try { fn(); } catch (error) {
    if (error instanceof PaperCanonicalOutcomeReconciliationError) return error.code;
    throw error;
  }
  throw new Error("expected PaperCanonicalOutcomeReconciliationError");
};

describe("canonical PAPER outcome reconciliation", () => {
  it("fails closed when a persisted fill has no execution-cost attribution", () => {
    const unattributed: PaperFillRecord = { id: "fill-1", orderId: "order-1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 100, fee: 0.05, filledAt: 1_500 };
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [unattributed]),
    })), "MISSING_EXECUTION_COST_EVIDENCE");
  });

  it("fails closed when fee attribution disagrees with persisted PAPER fill accounting", () => {
    const mismatched = fill({ executionCostAttribution: attribution({ feeAmount: 0.01 }) } as never);
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [mismatched]),
    })), "COST_RECONCILIATION_MISMATCH");
  });

  it("fails closed on stale period-boundary account snapshots", () => {
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START - 1, 1_000),
      endState: baseState(END, 1_000),
    })), "STALE_ACCOUNT_SNAPSHOT");
  });

  it("fails closed when candidate attribution is missing", () => {
    const missingCandidate = fill({ executionCostAttribution: attribution({ candidateId: " " }) } as never);
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [missingCandidate]),
    })), "MISSING_CANDIDATE_ATTRIBUTION");
  });

  it("reconciles explicit PAPER execution costs without inventing spread or slippage", () => {
    const attributed = fill();
    const result = reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [attributed]),
    });

    assert.equal(result.source, "CANONICAL_PAPER_ACCOUNT");
    assert.equal(result.fillCount, 1);
    assert.deepEqual(result.candidateIds, ["candidate-a"]);
    assert.equal(result.turnover, 0.1);
    assert.equal(result.feeRate, 0.0005);
    assert.equal(result.spreadRate, 0);
    assert.equal(result.slippageRate, 0);
    assert.ok(Math.abs(result.netReturn - 0.01) < 1e-12);
    assert.ok(Math.abs(result.grossReturn - 0.01005) < 1e-12);
    assert.match(result.receiptFingerprint, /^[a-f0-9]{64}$/);
  });

  it("keeps a no-fill realized interval explicit with zero turnover instead of fabricating execution costs", () => {
    const result = reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_005),
    });
    assert.equal(result.fillCount, 0);
    assert.equal(result.turnover, 0);
    assert.equal(result.feeRate, 0);
    assert.equal(result.spreadRate, 0);
    assert.equal(result.slippageRate, 0);
    assert.deepEqual(result.candidateIds, []);
  });
});
