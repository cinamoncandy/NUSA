import assert from "node:assert/strict";
import test from "node:test";
import type { PaperPerformanceFromLedgerResult } from "./paperPerformanceFromLedger";
import { evaluatePaperPerformanceGovernanceFeedback } from "./paperPerformanceGovernanceFeedback";

const identity = Object.freeze({
  strategyId: "lineage-a",
  version: "v1",
  name: "Strategy A",
  familyId: "family-a",
  createdAt: 1,
  gitCommitSha: "a".repeat(40),
  featureFingerprint: "b".repeat(64),
  engineVersion: "engine-v1",
  authorType: "HUMAN" as const,
});

const ledgerPerformance = Object.freeze({
  familyId: "family-a",
  canonicalOutcomeReceiptFingerprint: "c".repeat(64),
  ledgerSource: Object.freeze({ ledgerFingerprintSha256: "d".repeat(64) }),
  evidence: Object.freeze({
    schemaVersion: 1,
    evidenceKind: "PAPER",
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
    candidateId: "candidate-a",
    strategyId: "lineage-a",
    strategyVersion: "v1",
    periodStartAt: 100,
    periodEndAt: 200,
    observationCount: 3,
    initialEquity: 100,
    finalEquity: 101,
    netPnL: 1,
    realizedPnL: 1,
    unrealizedPnL: 0,
    returnRate: 0.01,
    maxDrawdownRate: 0.01,
    feeAmount: 0.1,
    fillCount: 2,
    sourceLedgerFingerprintSha256: "d".repeat(64),
    benchmarkId: "KRW-BTC",
    calculationVersion: "paper-performance-v1",
    generatedAt: 200,
    evidenceFingerprintSha256: "e".repeat(64),
  }),
}) as unknown as PaperPerformanceFromLedgerResult;

test("binds exact ledger performance identity into deterministic Governance feedback", () => {
  const input = { now: 200, identity, validation: undefined, paper: undefined, votes: [], ledgerPerformance };
  const first = evaluatePaperPerformanceGovernanceFeedback(input);
  const replay = evaluatePaperPerformanceGovernanceFeedback(input);
  assert.equal(first.decision.action, "REJECT");
  assert.equal(first.performanceEvidenceFingerprintSha256, "e".repeat(64));
  assert.equal(first.sourceLedgerFingerprintSha256, "d".repeat(64));
  assert.equal(first.receiptFingerprintSha256, replay.receiptFingerprintSha256);
  assert.equal(first.replayVerified, true);
  assert.equal(first.stale, false);
});

test("fails closed on Ledger or strategy identity drift", () => {
  assert.throws(() => evaluatePaperPerformanceGovernanceFeedback({
    now: 200,
    identity: { ...identity, familyId: "family-b" },
    validation: undefined,
    paper: undefined,
    votes: [],
    ledgerPerformance,
  }), /IDENTITY_MISMATCH/);
  const badLedger = { ...ledgerPerformance, ledgerSource: { ledgerFingerprintSha256: "f".repeat(64) } } as unknown as PaperPerformanceFromLedgerResult;
  assert.throws(() => evaluatePaperPerformanceGovernanceFeedback({
    now: 200,
    identity,
    validation: undefined,
    paper: undefined,
    votes: [],
    ledgerPerformance: badLedger,
  }), /LEDGER_IDENTITY_MISMATCH/);
});
