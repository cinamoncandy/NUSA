import type { OperationalCompletionStatus } from "./operationalCompletionGate";

export type ProfitabilityClaimStatus = "BLOCKED" | "INSUFFICIENT_EVIDENCE" | "ELIGIBLE_FOR_LIMITED_CLAIM";

export interface ProfitabilityClaimEvidence {
  readonly evaluatedAt: number;
  readonly operationalCompletionStatus: OperationalCompletionStatus;
  readonly outOfSampleClosedTrades: number;
  readonly paperClosedTrades: number;
  readonly outOfSampleExpectancy: number;
  readonly outOfSampleProfitFactor: number;
  readonly paperNetProfit: number;
  readonly paperProfitFactor: number;
  readonly markedMaximumDrawdown: number;
  readonly doubledCostReturn: number;
  readonly monteCarloRuinProbability: number;
  readonly benchmarkOutperformance: number;
  readonly datasetSha256: string;
  readonly scenarioEvidenceSha256: string;
}

export interface ProfitabilityClaimDecision {
  readonly status: ProfitabilityClaimStatus;
  readonly evaluatedAt: number;
  readonly reasons: readonly string[];
  readonly allowedClaim: string | null;
  readonly guaranteedProfitClaimAllowed: false;
  readonly liveReadinessImplied: false;
  readonly ownerApprovalRequired: true;
}

const LIMITED_CLAIM = "Positive expectancy was observed in cost-aware out-of-sample, stress, and Paper evidence under the recorded assumptions. This does not guarantee future profit.";

const count = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};
const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};
const sha = (value: string, field: string): void => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be lowercase SHA-256`);
};

export function evaluateProfitabilityClaim(evidence: ProfitabilityClaimEvidence): ProfitabilityClaimDecision {
  count(evidence.evaluatedAt, "evaluatedAt");
  count(evidence.outOfSampleClosedTrades, "outOfSampleClosedTrades");
  count(evidence.paperClosedTrades, "paperClosedTrades");
  for (const field of [
    "outOfSampleExpectancy",
    "outOfSampleProfitFactor",
    "paperNetProfit",
    "paperProfitFactor",
    "markedMaximumDrawdown",
    "doubledCostReturn",
    "monteCarloRuinProbability",
    "benchmarkOutperformance"
  ] as const) finite(evidence[field], field);
  sha(evidence.datasetSha256, "datasetSha256");
  sha(evidence.scenarioEvidenceSha256, "scenarioEvidenceSha256");
  if (evidence.markedMaximumDrawdown < 0 || evidence.markedMaximumDrawdown > 1) throw new Error("markedMaximumDrawdown must be between 0 and 1");
  if (evidence.monteCarloRuinProbability < 0 || evidence.monteCarloRuinProbability > 1) throw new Error("monteCarloRuinProbability must be between 0 and 1");

  const reasons: string[] = [];
  if (evidence.operationalCompletionStatus !== "READY_FOR_OWNER_REVIEW") reasons.push("OPERATIONAL_COMPLETION_NOT_READY");
  if (evidence.outOfSampleClosedTrades < 30) reasons.push("INSUFFICIENT_OOS_TRADES");
  if (evidence.paperClosedTrades < 50) reasons.push("INSUFFICIENT_PAPER_TRADES");
  if (evidence.outOfSampleExpectancy <= 0) reasons.push("OOS_EXPECTANCY_NOT_POSITIVE");
  if (evidence.outOfSampleProfitFactor < 1.2) reasons.push("OOS_PROFIT_FACTOR_BELOW_THRESHOLD");
  if (evidence.paperNetProfit <= 0) reasons.push("PAPER_NET_PROFIT_NOT_POSITIVE");
  if (evidence.paperProfitFactor < 1.2) reasons.push("PAPER_PROFIT_FACTOR_BELOW_THRESHOLD");
  if (evidence.markedMaximumDrawdown > 0.1) reasons.push("MAXIMUM_DRAWDOWN_ABOVE_THRESHOLD");
  if (evidence.doubledCostReturn < 0) reasons.push("DOUBLED_COST_RETURN_NEGATIVE");
  if (evidence.monteCarloRuinProbability > 0.02) reasons.push("MONTE_CARLO_RUIN_ABOVE_THRESHOLD");
  if (evidence.benchmarkOutperformance <= 0) reasons.push("BENCHMARK_OUTPERFORMANCE_NOT_POSITIVE");

  const operationalBlocked = reasons.includes("OPERATIONAL_COMPLETION_NOT_READY");
  const status: ProfitabilityClaimStatus = reasons.length === 0
    ? "ELIGIBLE_FOR_LIMITED_CLAIM"
    : operationalBlocked
      ? "BLOCKED"
      : "INSUFFICIENT_EVIDENCE";

  return Object.freeze({
    status,
    evaluatedAt: evidence.evaluatedAt,
    reasons: Object.freeze(reasons.sort()),
    allowedClaim: status === "ELIGIBLE_FOR_LIMITED_CLAIM" ? LIMITED_CLAIM : null,
    guaranteedProfitClaimAllowed: false as const,
    liveReadinessImplied: false as const,
    ownerApprovalRequired: true as const
  });
}
