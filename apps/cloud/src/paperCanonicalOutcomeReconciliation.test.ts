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
const HASH = "a".repeat(64);

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

const candidateProvenance = (candidateId = "candidate-a") => ({
  schemaVersion: 1,
  source: "CIO_DECISION_BINDING",
  decisionAt: 1_400,
  binding: {
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId,
    datasetId: "dataset-a",
    datasetContentSha256: HASH,
    advisoryGeneratedAt: 1_100,
    periodStartAt: 1_200,
    advisoryFingerprintSha256: HASH,
    bindingFingerprintSha256: HASH,
  },
} as const);

const attribution = (overrides: Partial<PaperExecutionCostAttribution> = {}): PaperExecutionCostAttribution => Object.freeze({
  schemaVersion: 1,
  source: "PAPER_EXECUTION_BOUNDARY",
  evidenceKind: "CONSERVATIVE_MODEL",
  evidenceId: "paper-cost-model:v1",
  evidenceFingerprintSha256: HASH,
  candidateId: "candidate-a",
  quotePrice: 100,
  fillPrice: 100,
  feeAmount: 0.05,
  spreadAmount: 0,
  slippageAmount: 0,
  ...overrides,
});

const fill = (overrides: Record<string, unknown> = {}): PaperFillRecord => ({
  id: "fill-1",
  orderId: "order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 1,
  price: 100,
  fee: 0.05,
  filledAt: 1_500,
  candidateProvenance: candidateProvenance(),
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
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill({ executionCostAttribution: undefined })]),
    })), "MISSING_EXECUTION_COST_EVIDENCE");
  });

  it("fails closed when execution-cost evidence identity is absent", () => {
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill({ executionCostAttribution: attribution({ evidenceId: "", evidenceFingerprintSha256: "bad" }) })]),
    })), "INVALID_EXECUTION_COST_PROVENANCE");
  });

  it("fails closed when candidate attribution disagrees with persisted candidate provenance", () => {
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill({ executionCostAttribution: attribution({ candidateId: "candidate-b" }) })]),
    })), "CANDIDATE_ATTRIBUTION_MISMATCH");
  });

  it("fails closed when canonical candidate provenance is absent", () => {
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill({ candidateProvenance: undefined })]),
    })), "MISSING_CANDIDATE_PROVENANCE");
  });

  it("fails closed when fee attribution disagrees with persisted PAPER fill accounting", () => {
    assert.equal(code(() => reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill({ executionCostAttribution: attribution({ feeAmount: 0.01 }) })]),
    })), "COST_RECONCILIATION_MISMATCH");
  });

  it("reconciles explicit candidate-bound PAPER execution costs", () => {
    const result = reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_010, [fill()]),
    });
    assert.deepEqual(result.candidateIds, ["candidate-a"]);
    assert.deepEqual(result.executionCostEvidenceIds, ["paper-cost-model:v1"]);
    assert.equal(result.turnover, 0.1);
    assert.equal(result.feeRate, 0.0005);
    assert.equal(result.spreadRate, 0);
    assert.equal(result.slippageRate, 0);
    assert.match(result.receiptFingerprint, /^[a-f0-9]{64}$/);
  });

  it("keeps a no-fill interval explicit without fabricating execution costs", () => {
    const result = reconcileCanonicalPaperOutcomeWindow({
      periodStartAt: START,
      periodEndAt: END,
      startState: baseState(START, 1_000),
      endState: baseState(END, 1_005),
    });
    assert.equal(result.fillCount, 0);
    assert.deepEqual(result.executionCostEvidenceIds, []);
  });
});
