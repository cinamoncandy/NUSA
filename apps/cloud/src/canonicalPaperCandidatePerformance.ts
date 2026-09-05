import type { PaperForwardPeriodEvidence } from "../../../packages/contracts/src/paperForwardEvidence";
import type { PaperPerformanceSummary } from "../../../packages/contracts/src/strategyGovernance";
import { evaluateExecutionQuality } from "./executionQualityEngine";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";

export interface CanonicalPaperExecutionQualityPolicy {
  readonly acceptableSlippageBps: number;
  readonly poorSlippageBps: number;
  readonly acceptableLatencyMs: number;
  readonly poorLatencyMs: number;
}

export interface CanonicalPaperCandidatePerformanceInput {
  readonly candidateId: string;
  readonly periods: readonly PaperForwardPeriodEvidence[];
  readonly account: PaperAccountState;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
}

const DAY_MS = 86_400_000;
const finite = (value: number, field: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
};
const required = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

function periodNetReturn(period: PaperForwardPeriodEvidence): number {
  const cost = period.turnover * (period.feeRate + period.spreadRate + period.slippageRate);
  const value = period.grossReturn - cost;
  if (!Number.isFinite(value) || value <= -1) throw new Error("candidate PAPER net return is invalid");
  return value;
}

function sampleSharpe(returns: readonly number[]): number | undefined {
  if (returns.length < 2) return undefined;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  if (!Number.isFinite(variance) || variance <= 0) return undefined;
  return finite((mean / Math.sqrt(variance)) * Math.sqrt(returns.length), "candidate PAPER Sharpe");
}

function profitFactor(returns: readonly number[]): number | undefined {
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (!(gains > 0) || !(losses > 0)) return undefined;
  return finite(gains / losses, "candidate PAPER profit factor");
}

function maximumDrawdown(returns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    if (!Number.isFinite(equity) || equity <= 0) throw new Error("candidate PAPER equity path is invalid");
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, (peak - equity) / peak);
  }
  return finite(drawdown, "candidate PAPER maximum drawdown");
}

function cumulativeReturn(returns: readonly number[]): number {
  return finite(returns.reduce((equity, value) => equity * (1 + value), 1) - 1, "candidate PAPER cumulative return");
}

function candidateFills(candidateId: string, datasetId: string, startAt: number, endAt: number, account: PaperAccountState): readonly PaperFillRecord[] {
  return Object.freeze(account.fills.filter((fill) => {
    const binding = fill.candidateProvenance?.binding;
    return fill.filledAt >= startAt && fill.filledAt <= endAt && binding?.candidateId === candidateId && binding.datasetId === datasetId;
  }));
}

function executionQualityScore(fills: readonly PaperFillRecord[], account: PaperAccountState, policy: CanonicalPaperExecutionQualityPolicy): number | undefined {
  if (fills.length === 0) return undefined;
  const orders = new Map(account.orders.map((order) => [order.id, order] as const));
  let weighted = 0;
  let notional = 0;
  for (const fill of fills) {
    const order = orders.get(fill.orderId);
    if (order == null) throw new Error("candidate PAPER fill is missing its canonical order");
    const quality = evaluateExecutionQuality({
      symbol: fill.market,
      side: fill.side,
      expectedPrice: order.price,
      actualPrice: fill.price,
      quantity: fill.quantity,
      feePaid: fill.fee,
      submittedAt: order.createdAt,
      filledAt: fill.filledAt,
      acceptableSlippageBps: policy.acceptableSlippageBps,
      poorSlippageBps: policy.poorSlippageBps,
      acceptableLatencyMs: policy.acceptableLatencyMs,
      poorLatencyMs: policy.poorLatencyMs,
    });
    const weight = fill.price * fill.quantity;
    const score = quality.quality === "GOOD" ? 1 : quality.quality === "ACCEPTABLE" ? 0.5 : 0;
    weighted += score * weight;
    notional += weight;
  }
  if (!(notional > 0)) return undefined;
  return finite(weighted / notional, "candidate PAPER execution quality");
}

/**
 * Produces the existing canonical `PaperPerformanceSummary` strictly from candidate-bound persisted
 * forward periods plus candidate-bound canonical PAPER fills/orders. No missing metric is defaulted:
 * if Sharpe, profit factor, trades, or execution quality are not empirically identifiable yet, the
 * result remains unavailable and League must keep the candidate INSUFFICIENT.
 */
export function buildCanonicalPaperCandidatePerformance(input: CanonicalPaperCandidatePerformanceInput): PaperPerformanceSummary | undefined {
  const candidateId = required(input.candidateId, "candidateId");
  if (input.periods.length === 0) return undefined;
  const periods = [...input.periods].sort((left, right) => left.periodStartAt - right.periodStartAt || left.periodId.localeCompare(right.periodId));
  const first = periods[0]!;
  const datasetId = required(first.datasetId, "datasetId");
  let previousEndAt = -1;
  for (const period of periods) {
    if (period.candidateId !== candidateId || period.datasetId !== datasetId || period.datasetContentSha256 !== first.datasetContentSha256) throw new Error("candidate PAPER performance provenance mismatch");
    if (period.periodStartAt < previousEndAt || period.periodEndAt <= period.periodStartAt) throw new Error("candidate PAPER performance chronology is invalid");
    previousEndAt = period.periodEndAt;
  }
  const completed = periods.filter((period) => period.status === "COMPLETED");
  if (completed.length === 0) return undefined;
  const returns = completed.map(periodNetReturn);
  const sharpeRatio = sampleSharpe(returns);
  const factor = profitFactor(returns);
  if (sharpeRatio == null || factor == null) return undefined;

  const startedAt = periods[0]!.periodStartAt;
  const endedAt = periods.at(-1)!.periodEndAt;
  const fills = candidateFills(candidateId, datasetId, startedAt, endedAt, input.account);
  const executionQuality = executionQualityScore(fills, input.account, input.executionQualityPolicy);
  if (fills.length === 0 || executionQuality == null) return undefined;

  const rejectedCount = periods.filter((period) => period.status === "REJECTED").length;
  const haltedCount = periods.filter((period) => period.status === "HALTED").length;
  return Object.freeze({
    startedAt,
    endedAt,
    observationDays: Math.max(1, Math.ceil((endedAt - startedAt) / DAY_MS)),
    tradeCount: fills.length,
    netReturn: cumulativeReturn(returns),
    sharpeRatio,
    profitFactor: factor,
    maximumDrawdown: maximumDrawdown(returns),
    availabilityRatio: completed.length / periods.length,
    unresolvedFaultCount: rejectedCount,
    killSwitchActivationCount: haltedCount,
    executionQualityScore: executionQuality,
  });
}
