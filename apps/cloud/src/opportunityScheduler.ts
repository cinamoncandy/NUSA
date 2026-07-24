export type OpportunitySide = "LONG" | "SHORT" | "NEUTRAL";

export interface OpportunityCandidate {
  readonly id: string;
  readonly asset: string;
  readonly side: OpportunitySide;
  readonly netEdge: number;
  readonly confidence: number;
  readonly executionQuality: number;
  readonly liquidity: number;
  readonly remainingLifetimeMs: number;
  readonly initialLifetimeMs: number;
  readonly regimeFit: number;
  readonly maximumAllocation: number;
}

export interface OpportunityConflict {
  readonly leftId: string;
  readonly rightId: string;
  readonly correlation: number;
}

export interface OpportunityScheduleInput {
  readonly mode: "PAPER" | "DRY_RUN";
  readonly killSwitchActive: boolean;
  readonly deployableCapital: number;
  readonly maximumPortfolioAllocation: number;
  readonly maximumCorrelatedAllocation: number;
  readonly minimumScore: number;
  readonly candidates: readonly OpportunityCandidate[];
  readonly conflicts: readonly OpportunityConflict[];
}

export interface ScheduledOpportunity {
  readonly id: string;
  readonly asset: string;
  readonly side: OpportunitySide;
  readonly score: number;
  readonly allocation: number;
  readonly rank: number;
  readonly reasons: readonly string[];
}

export interface OpportunitySchedule {
  readonly mode: "PAPER" | "DRY_RUN";
  readonly totalAllocation: number;
  readonly reservedCash: number;
  readonly opportunities: readonly ScheduledOpportunity[];
  readonly rejected: readonly Readonly<{ id: string; reason: string }>[];
}

const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};
const ratio = (value: number, field: string): void => {
  finite(value, field);
  if (value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const money = (value: number, field: string): void => {
  finite(value, field);
  if (value < 0) throw new Error(`${field} must be non-negative`);
};
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function scoreCandidate(candidate: OpportunityCandidate): number {
  finite(candidate.netEdge, "netEdge");
  ratio(candidate.confidence, "confidence");
  ratio(candidate.executionQuality, "executionQuality");
  ratio(candidate.liquidity, "liquidity");
  ratio(candidate.regimeFit, "regimeFit");
  ratio(candidate.maximumAllocation, "maximumAllocation");
  if (!Number.isSafeInteger(candidate.remainingLifetimeMs) || candidate.remainingLifetimeMs < 0) throw new Error("remainingLifetimeMs is invalid");
  if (!Number.isSafeInteger(candidate.initialLifetimeMs) || candidate.initialLifetimeMs <= 0) throw new Error("initialLifetimeMs is invalid");
  const lifetimeRatio = Math.max(0, Math.min(1, candidate.remainingLifetimeMs / candidate.initialLifetimeMs));
  return round6(Math.max(0, candidate.netEdge) * candidate.confidence * candidate.executionQuality * candidate.liquidity * lifetimeRatio * candidate.regimeFit);
}

const sameDirectionalConflict = (left: OpportunityCandidate, right: OpportunityCandidate, correlation: number): boolean =>
  left.side === right.side && left.side !== "NEUTRAL" && correlation >= 0.8;

export function buildOpportunitySchedule(input: OpportunityScheduleInput): OpportunitySchedule {
  if (input.mode !== "PAPER" && input.mode !== "DRY_RUN") throw new Error("only PAPER or DRY_RUN is supported");
  money(input.deployableCapital, "deployableCapital");
  ratio(input.maximumPortfolioAllocation, "maximumPortfolioAllocation");
  ratio(input.maximumCorrelatedAllocation, "maximumCorrelatedAllocation");
  finite(input.minimumScore, "minimumScore");
  if (input.minimumScore < 0) throw new Error("minimumScore must be non-negative");

  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (!candidate.id.trim() || !candidate.asset.trim()) throw new Error("candidate id and asset are required");
    if (ids.has(candidate.id)) throw new Error("duplicate opportunity id");
    ids.add(candidate.id);
  }

  if (input.killSwitchActive || input.deployableCapital === 0) {
    const rejected = input.candidates
      .map((candidate) => Object.freeze({ id: candidate.id, reason: input.killSwitchActive ? "KILL_SWITCH_ACTIVE" : "NO_DEPLOYABLE_CAPITAL" }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({ mode: input.mode, totalAllocation: 0, reservedCash: input.deployableCapital, opportunities: Object.freeze([]), rejected: Object.freeze(rejected) });
  }

  const conflicts = new Map<string, OpportunityConflict[]>();
  const conflictKeys = new Set<string>();
  for (const conflict of input.conflicts) {
    ratio(conflict.correlation, "correlation");
    if (!ids.has(conflict.leftId) || !ids.has(conflict.rightId) || conflict.leftId === conflict.rightId) throw new Error("invalid opportunity conflict");
    const conflictKey = [conflict.leftId, conflict.rightId].sort().join("::");
    if (conflictKeys.has(conflictKey)) throw new Error("duplicate opportunity conflict");
    conflictKeys.add(conflictKey);
    conflicts.set(conflict.leftId, [...(conflicts.get(conflict.leftId) ?? []), conflict]);
    conflicts.set(conflict.rightId, [...(conflicts.get(conflict.rightId) ?? []), conflict]);
  }

  const ranked = input.candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .sort((a, b) => b.score - a.score || b.candidate.netEdge - a.candidate.netEdge || a.candidate.id.localeCompare(b.candidate.id));

  const portfolioBudget = input.deployableCapital * input.maximumPortfolioAllocation;
  let remaining = portfolioBudget;
  const accepted: Array<{ candidate: OpportunityCandidate; score: number; allocation: number; reasons: string[] }> = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const item of ranked) {
    if (item.score < input.minimumScore || item.candidate.remainingLifetimeMs === 0 || item.candidate.netEdge <= 0) {
      rejected.push({ id: item.candidate.id, reason: "INSUFFICIENT_LIVE_EDGE" });
      continue;
    }

    const related = conflicts.get(item.candidate.id) ?? [];
    let hasDirectionalConflict = false;
    const conflictingAllocation = accepted.reduce((sum, existing) => {
      const match = related.find((entry) => entry.leftId === existing.candidate.id || entry.rightId === existing.candidate.id);
      if (match && sameDirectionalConflict(item.candidate, existing.candidate, match.correlation)) {
        hasDirectionalConflict = true;
        return sum + existing.allocation;
      }
      return sum;
    }, 0);
    const correlatedCap = portfolioBudget * input.maximumCorrelatedAllocation;
    const availableCorrelated = hasDirectionalConflict ? Math.max(0, correlatedCap - conflictingAllocation) : remaining;
    const desired = Math.min(portfolioBudget * item.candidate.maximumAllocation, remaining, availableCorrelated);
    if (desired <= 0) {
      rejected.push({ id: item.candidate.id, reason: hasDirectionalConflict && conflictingAllocation >= correlatedCap ? "CORRELATION_BUDGET_EXHAUSTED" : "PORTFOLIO_BUDGET_EXHAUSTED" });
      continue;
    }
    accepted.push({ candidate: item.candidate, score: item.score, allocation: desired, reasons: ["POSITIVE_NET_EDGE", "EXECUTION_AND_REGIME_APPROVED"] });
    remaining -= desired;
  }

  const opportunities = accepted.map((item, index) => Object.freeze({
    id: item.candidate.id,
    asset: item.candidate.asset,
    side: item.candidate.side,
    score: item.score,
    allocation: round6(item.allocation),
    rank: index + 1,
    reasons: Object.freeze(item.reasons.sort())
  }));
  const totalAllocation = round6(opportunities.reduce((sum, item) => sum + item.allocation, 0));
  return Object.freeze({
    mode: input.mode,
    totalAllocation,
    reservedCash: round6(input.deployableCapital - totalAllocation),
    opportunities: Object.freeze(opportunities),
    rejected: Object.freeze(rejected.sort((a, b) => a.id.localeCompare(b.id)).map((item) => Object.freeze(item)))
  });
}
