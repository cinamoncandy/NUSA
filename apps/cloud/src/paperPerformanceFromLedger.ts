import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { validatePaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { buildDurablePaperAccountingSource, type DurablePaperAccountingSource } from "./paperAccountingLedger";
import { reconcileCanonicalPaperOutcomeWindow } from "./paperCanonicalOutcomeReconciliation";
import { buildPaperPerformanceEvidence, type PaperPerformanceEvidence } from "./paperPerformanceEvidence";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";

const SHA256 = /^[a-f0-9]{64}$/;

export interface PaperPerformanceFromLedgerInput {
  readonly period: PersistedPaperPeriodEnvelope;
  readonly accountHistory: readonly PaperAccountState[];
  /** Complete durable fill truth from the canonical PAPER repository. */
  readonly durableFills?: readonly PaperFillRecord[];
  readonly generatedAt?: number;
  readonly calculationVersion?: string;
}

export interface PaperPerformanceFromLedgerResult {
  readonly evidence: PaperPerformanceEvidence;
  readonly familyId: string;
  readonly ledgerSource: DurablePaperAccountingSource;
  readonly canonicalOutcomeReceiptFingerprint: string;
}

function exactBoundary(history: readonly PaperAccountState[], at: number, label: string): PaperAccountState {
  const matches = history.filter((state) => state.updatedAt === at);
  if (matches.length !== 1) throw new Error(`PAPER_PERFORMANCE_${label}_BOUNDARY_UNAVAILABLE`);
  return matches[0]!;
}

function strategyIdentity(periodFills: readonly PaperFillRecord[], candidateId: string): Readonly<{
  familyId: string;
  lineageId: string;
  specificationHash: string;
}> {
  if (periodFills.length === 0) throw new Error("PAPER_PERFORMANCE_PERIOD_HAS_NO_FILLS");
  let canonical: string | undefined;
  let result: { familyId: string; lineageId: string; specificationHash: string } | undefined;
  for (const fill of periodFills) {
    const provenance = fill.candidateProvenance;
    if (provenance == null) throw new Error("PAPER_PERFORMANCE_CANDIDATE_PROVENANCE_UNAVAILABLE");
    const binding = validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt);
    if (binding.candidateId !== candidateId || binding.candidateStrategy == null) throw new Error("PAPER_PERFORMANCE_STRATEGY_IDENTITY_UNAVAILABLE");
    const strategy = binding.candidateStrategy;
    const identity = JSON.stringify({
      candidateId: strategy.candidateId,
      familyId: strategy.familyId,
      lineageId: strategy.lineageId,
      specificationHash: strategy.specificationHash,
      codeSha: strategy.codeSha,
      costModelVersion: strategy.costModelVersion,
      parameters: strategy.parameters,
    });
    if (canonical !== undefined && canonical !== identity) throw new Error("PAPER_PERFORMANCE_STRATEGY_IDENTITY_CONFLICT");
    canonical = identity;
    result = { familyId: strategy.familyId, lineageId: strategy.lineageId, specificationHash: strategy.specificationHash };
  }
  return Object.freeze(result!);
}

export function buildPaperPerformanceFromLedger(input: PaperPerformanceFromLedgerInput): PaperPerformanceFromLedgerResult {
  const record = input.period.record;
  if (record.status !== "COMPLETED") throw new Error("PAPER_PERFORMANCE_PERIOD_NOT_COMPLETED");
  if (!Number.isSafeInteger(record.periodStartAt) || !Number.isSafeInteger(record.periodEndAt) || record.periodEndAt <= record.periodStartAt) throw new Error("PAPER_PERFORMANCE_PERIOD_INVALID");
  if (!record.market?.trim() || !record.canonicalOutcomeReceiptFingerprint || !SHA256.test(record.canonicalOutcomeReceiptFingerprint)) throw new Error("PAPER_PERFORMANCE_PERIOD_PROVENANCE_INCOMPLETE");
  if (input.period.candidateProvenance.length !== 1) throw new Error("PAPER_PERFORMANCE_CANDIDATE_ATTRIBUTION_UNAVAILABLE");
  const candidateId = input.period.candidateProvenance[0]!.candidateId;
  if (!candidateId.trim()) throw new Error("PAPER_PERFORMANCE_CANDIDATE_ATTRIBUTION_UNAVAILABLE");

  const startState = exactBoundary(input.accountHistory, record.periodStartAt, "START");
  const endState = exactBoundary(input.accountHistory, record.periodEndAt, "END");
  const startLedger = buildDurablePaperAccountingSource(input.accountHistory, record.periodStartAt, input.durableFills);
  const endLedger = buildDurablePaperAccountingSource(input.accountHistory, record.periodEndAt, input.durableFills);

  const startFillIds = new Set(startLedger.fills.map((fill) => fill.id));
  const periodFills = Object.freeze(endLedger.fills.filter((fill) =>
    !startFillIds.has(fill.id) && fill.filledAt > record.periodStartAt && fill.filledAt <= record.periodEndAt
  ));

  const durableStartState: PaperAccountState = Object.freeze({ ...startState, fills: startLedger.fills });
  const durableEndState: PaperAccountState = Object.freeze({ ...endState, fills: endLedger.fills });
  const receipt = reconcileCanonicalPaperOutcomeWindow({
    periodStartAt: record.periodStartAt,
    periodEndAt: record.periodEndAt,
    startState: durableStartState,
    endState: durableEndState,
    canonicalFills: endLedger.fills,
  });
  if (receipt.receiptFingerprint !== record.canonicalOutcomeReceiptFingerprint) throw new Error("PAPER_PERFORMANCE_OUTCOME_RECEIPT_MISMATCH");
  if (receipt.candidateIds.length !== 1 || receipt.candidateIds[0] !== candidateId) throw new Error("PAPER_PERFORMANCE_CANDIDATE_ATTRIBUTION_MISMATCH");
  if (record.realizedReturns[candidateId] !== receipt.netReturn) throw new Error("PAPER_PERFORMANCE_REALIZED_RETURN_MISMATCH");

  const strategy = strategyIdentity(periodFills, candidateId);
  const curve = input.accountHistory
    .filter((state) => state.updatedAt >= record.periodStartAt && state.updatedAt <= record.periodEndAt)
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .map((state) => Object.freeze({ observedAt: state.updatedAt, equity: state.equity }));
  if (curve.length < 2 || curve[0]!.observedAt !== record.periodStartAt || curve.at(-1)!.observedAt !== record.periodEndAt) throw new Error("PAPER_PERFORMANCE_EQUITY_HISTORY_INCOMPLETE");
  for (let index = 1; index < curve.length; index += 1) {
    if (curve[index]!.observedAt <= curve[index - 1]!.observedAt) throw new Error("PAPER_PERFORMANCE_EQUITY_HISTORY_INVALID");
  }

  const feeAmount = periodFills.reduce((sum, fill) => sum + fill.fee, 0);
  const generatedAt = input.generatedAt ?? record.periodEndAt;
  const evidence = buildPaperPerformanceEvidence({
    candidateId,
    strategyId: strategy.lineageId,
    strategyVersion: strategy.specificationHash,
    periodStartAt: record.periodStartAt,
    periodEndAt: record.periodEndAt,
    equityCurve: curve,
    realizedPnL: endState.realizedPnL - startState.realizedPnL,
    unrealizedPnL: endState.unrealizedPnL - startState.unrealizedPnL,
    feeAmount,
    fillCount: periodFills.length,
    sourceLedgerFingerprintSha256: endLedger.ledgerFingerprintSha256,
    benchmarkId: record.market,
    calculationVersion: input.calculationVersion ?? "paper-performance-v1",
    generatedAt,
  });

  return Object.freeze({
    evidence,
    familyId: strategy.familyId,
    ledgerSource: endLedger,
    canonicalOutcomeReceiptFingerprint: receipt.receiptFingerprint,
  });
}
