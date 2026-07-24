import type { InvestmentCommitteeResult } from "../../../packages/contracts/src/investmentCommittee";

export interface InvestmentCommitteeBriefingInput {
  readonly asset: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly result: InvestmentCommitteeResult;
  readonly generatedAt: number;
  readonly maximumAgeMs: number;
}

export interface InvestmentCommitteeBriefing {
  readonly asset: string;
  readonly strategy: string;
  readonly decision: InvestmentCommitteeResult["decision"];
  readonly status: "ACTIONABLE" | "CAUTION" | "BLOCKED";
  readonly confidencePercent: number;
  readonly edgePercent: number;
  readonly riskPercent: number;
  readonly agreementPercent: number;
  readonly conflictLevel: InvestmentCommitteeResult["consensus"]["conflictLevel"];
  readonly vetoes: readonly string[];
  readonly reasons: readonly string[];
  readonly generatedAt: number;
}

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

const percent = (value: number): number => Math.round(value * 10_000) / 100;

export function buildInvestmentCommitteeBriefing(
  input: InvestmentCommitteeBriefingInput,
  now: number
): InvestmentCommitteeBriefing {
  time(now, "now");
  time(input.generatedAt, "generatedAt");
  time(input.maximumAgeMs, "maximumAgeMs");
  if (input.generatedAt > now) throw new Error("committee briefing cannot come from the future");
  if (now - input.generatedAt > input.maximumAgeMs) throw new Error("committee briefing is stale");

  const asset = text(input.asset, "asset").toUpperCase();
  const strategyId = text(input.strategyId, "strategyId");
  const strategyVersion = text(input.strategyVersion, "strategyVersion");
  const vetoes = Object.freeze([...input.result.consensus.vetoReasons].sort());
  const reasons = Object.freeze([...input.result.reasons].sort());
  const blocked = input.result.decision === "REJECT" || input.result.decision === "EMERGENCY_EXIT" || vetoes.length > 0;
  const caution = input.result.decision === "WAIT" || input.result.decision === "PAPER_ONLY" || input.result.decision === "APPROVE_PARTIAL" || input.result.consensus.conflictLevel === "HIGH" || input.result.consensus.conflictLevel === "CRITICAL";

  return Object.freeze({
    asset,
    strategy: `${strategyId}@${strategyVersion}`,
    decision: input.result.decision,
    status: blocked ? "BLOCKED" : caution ? "CAUTION" : "ACTIONABLE",
    confidencePercent: percent(input.result.consensus.weightedConfidence),
    edgePercent: percent(input.result.consensus.weightedEdge),
    riskPercent: percent(input.result.consensus.weightedRisk),
    agreementPercent: percent(input.result.consensus.agreementScore),
    conflictLevel: input.result.consensus.conflictLevel,
    vetoes,
    reasons,
    generatedAt: input.generatedAt
  });
}
