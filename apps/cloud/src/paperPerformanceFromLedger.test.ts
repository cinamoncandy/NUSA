import assert from "node:assert/strict";
import test from "node:test";
import { bindPaperCandidateForExecution, type PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { reconcileCanonicalPaperOutcomeWindow } from "./paperCanonicalOutcomeReconciliation";
import { buildPaperPerformanceFromLedger } from "./paperPerformanceFromLedger";
import type { PaperAccountState, PaperFillRecord, PaperOrderRecord } from "./paperTradingExecutionLoop";

const candidateId = "candidate-1";
const provenance: readonly PersistedPaperCandidateProvenance[] = Object.freeze([{
  candidateId,
  datasetId: "dataset-1",
  datasetContentSha256: "a".repeat(64),
}]);
const advisory: LeagueCapitalAllocationAdvisory = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(500).toISOString(),
  policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
  entries: Object.freeze([{
    id: candidateId,
    familyId: "family-1",
    rank: 1,
    leagueScore: 1,
    evidenceBreadth: 1,
    researchWeight: 1,
    reasons: Object.freeze(["test"]),
    sourceDatasetIds: Object.freeze(["dataset-1"]),
  }]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["test"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-1"]) }),
});
const strategy: PaperCandidateStrategySpec = Object.freeze({
  candidateId,
  familyId: "family-1",
  lineageId: "lineage-1",
  specificationHash: "b".repeat(64),
  codeSha: "c".repeat(40),
  costModelVersion: "cost-v1",
  parameters: Object.freeze({ window: 20 }),
});
const binding = bindPaperCandidateForExecution(advisory, provenance, candidateId, 1_000, strategy);

const fill: PaperFillRecord = Object.freeze({
  id: "fill-1",
  orderId: "order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 1,
  price: 100,
  fee: 1,
  filledAt: 1_500,
  candidateProvenance: Object.freeze({ schemaVersion: 1, source: "CIO_DECISION_BINDING", decisionAt: 1_200, binding }),
  executionCostAttribution: Object.freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: "CONSERVATIVE_MODEL",
    evidenceId: "cost-evidence-1",
    evidenceFingerprintSha256: "d".repeat(64),
    candidateId,
    quotePrice: 100,
    fillPrice: 100,
    feeAmount: 1,
    spreadAmount: 0,
    slippageAmount: 0,
  }),
});
const order: PaperOrderRecord = Object.freeze({
  id: "order-1",
  idempotencyKey: "paper-key-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 1,
  price: 100,
  fee: 1,
  status: "FILLED",
  createdAt: 1_500,
  filledAt: 1_500,
});
const start: PaperAccountState = Object.freeze({
  version: 1, initialCapital: 1_000, cash: 1_000, equity: 1_000, realizedPnL: 0, unrealizedPnL: 0,
  positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: 1_000,
});
const middle: PaperAccountState = Object.freeze({
  version: 1, initialCapital: 1_000, cash: 899, equity: 999, realizedPnL: 0, unrealizedPnL: -1,
  positions: Object.freeze([{ market: "KRW-BTC", quantity: 1, averageEntryPrice: 101, realizedPnL: 0, unrealizedPnL: -1, markPrice: 100 }]),
  orders: Object.freeze([order]), fills: Object.freeze([fill]), processedIdempotencyKeys: Object.freeze(["paper-key-1"]), updatedAt: 1_500,
});
const end: PaperAccountState = Object.freeze({
  version: 1, initialCapital: 1_000, cash: 899, equity: 1_009, realizedPnL: 0, unrealizedPnL: 9,
  positions: Object.freeze([{ market: "KRW-BTC", quantity: 1, averageEntryPrice: 101, realizedPnL: 0, unrealizedPnL: 9, markPrice: 110 }]),
  orders: Object.freeze([order]), fills: Object.freeze([fill]), processedIdempotencyKeys: Object.freeze(["paper-key-1"]), updatedAt: 2_000,
});

function period(): PersistedPaperPeriodEnvelope {
  const receipt = reconcileCanonicalPaperOutcomeWindow({ periodStartAt: 1_000, periodEndAt: 2_000, startState: start, endState: end });
  assert.equal(receipt.candidateIds[0], candidateId);
  assert.ok(receipt.executionCostEvidenceKind);
  assert.ok(receipt.executionCostEvidenceFingerprint);
  return Object.freeze({
    record: Object.freeze({
      recordId: "period-1",
      periodIndex: 0,
      market: "KRW-BTC",
      advisory,
      periodStartAt: 1_000,
      periodEndAt: 2_000,
      realizedReturns: Object.freeze({ [candidateId]: receipt.netReturn }),
      benchmarkReturn: 0.01,
      turnoverCostRate: receipt.feeRate + receipt.spreadRate + receipt.slippageRate,
      costEvidence: Object.freeze({
        evidenceId: "paper-canonical-outcome:" + receipt.receiptFingerprint,
        source: "PAPER_EXECUTION_RECEIPT",
        evidenceKind: receipt.executionCostEvidenceKind!,
        evidenceFingerprintSha256: receipt.executionCostEvidenceFingerprint!,
        observedAt: 2_000,
        feeRate: receipt.feeRate,
        spreadRate: receipt.spreadRate,
        slippageRate: receipt.slippageRate,
      }),
      status: "COMPLETED",
      benchmarkEvidenceId: "benchmark-1",
      canonicalOutcomeReceiptFingerprint: receipt.receiptFingerprint,
    }),
    candidateProvenance: provenance,
  });
}

test("derives PAPER performance only from durable ledger and realized-period truth", () => {
  const result = buildPaperPerformanceFromLedger({ period: period(), accountHistory: [start, middle, end] });
  assert.equal(result.familyId, "family-1");
  assert.equal(result.evidence.candidateId, candidateId);
  assert.equal(result.evidence.strategyId, "lineage-1");
  assert.equal(result.evidence.strategyVersion, "b".repeat(64));
  assert.equal(result.evidence.sourceLedgerFingerprintSha256, result.ledgerSource.ledgerFingerprintSha256);
  assert.equal(result.evidence.fillCount, 1);
  assert.equal(result.evidence.feeAmount, 1);
  assert.equal(result.evidence.initialEquity, 1_000);
  assert.equal(result.evidence.finalEquity, 1_009);
  assert.equal(result.evidence.maxDrawdownRate, 0.001);
  assert.equal(result.evidence.authority, "PAPER_ONLY");
  assert.equal(result.evidence.liveAuthority, "NONE");
  assert.equal(result.evidence.aiAuthority, "ZERO_AUTHORITY");
});

test("uses canonical durable fills when bounded account-history snapshots no longer retain the fill", () => {
  const boundedMiddle: PaperAccountState = Object.freeze({ ...middle, fills: Object.freeze([]) });
  const boundedEnd: PaperAccountState = Object.freeze({ ...end, fills: Object.freeze([]) });
  const result = buildPaperPerformanceFromLedger({
    period: period(),
    accountHistory: [start, boundedMiddle, boundedEnd],
    durableFills: [fill],
  });
  assert.equal(result.evidence.fillCount, 1);
  assert.equal(result.evidence.feeAmount, 1);
  assert.equal(result.evidence.finalEquity, 1_009);
  assert.equal(result.ledgerSource.fills.length, 1);
  assert.equal(result.ledgerSource.fills[0]?.id, fill.id);
});

test("fails closed when persisted period outcome fingerprint is not the durable account outcome", () => {
  const valid = period();
  const tampered: PersistedPaperPeriodEnvelope = Object.freeze({
    ...valid,
    record: Object.freeze({ ...valid.record, canonicalOutcomeReceiptFingerprint: "e".repeat(64) }),
  });
  assert.throws(() => buildPaperPerformanceFromLedger({ period: tampered, accountHistory: [start, middle, end] }), /PAPER_PERFORMANCE_OUTCOME_RECEIPT_MISMATCH/);
});

test("fails closed when durable fill bytes disagree with a retained history fill", () => {
  const tamperedFill: PaperFillRecord = Object.freeze({ ...fill, fee: 2 });
  assert.throws(
    () => buildPaperPerformanceFromLedger({ period: period(), accountHistory: [start, middle, end], durableFills: [tamperedFill] }),
    /PAPER_LEDGER_DURABLE_HISTORY_MISMATCH/
  );
});

test("fails closed when durable history loses a processed order identity", () => {
  const incompleteEnd: PaperAccountState = Object.freeze({ ...end, orders: Object.freeze([]) });
  assert.throws(() => buildPaperPerformanceFromLedger({ period: period(), accountHistory: [start, incompleteEnd] }), /PAPER_LEDGER_HISTORY_INCOMPLETE/);
});
