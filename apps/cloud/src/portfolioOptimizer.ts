export interface PortfolioCandidate {
  readonly strategyId: string;
  readonly expectedReturn: number;
  readonly risk: number;
  readonly requestedWeight: number;
}

export interface PortfolioOptimizerPolicy {
  readonly maximumGrossWeight: number;
  readonly minimumCashWeight: number;
  readonly maximumStrategyWeight: number;
}

export interface PortfolioAllocation {
  readonly strategyId: string;
  readonly weight: number;
}

export interface PortfolioOptimizationResult {
  readonly allocations: readonly PortfolioAllocation[];
  readonly cashWeight: number;
  readonly rejectedStrategyIds: readonly string[];
  readonly reasons: readonly string[];
  readonly productionMutationAllowed: false;
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

export const optimizePortfolio = (candidates: readonly PortfolioCandidate[], policy: PortfolioOptimizerPolicy): PortfolioOptimizationResult => {
  ratio(policy.maximumGrossWeight, "maximumGrossWeight");
  ratio(policy.minimumCashWeight, "minimumCashWeight");
  ratio(policy.maximumStrategyWeight, "maximumStrategyWeight");
  if (policy.maximumGrossWeight + policy.minimumCashWeight > 1) throw new Error("portfolio limits exceed total capital");
  const seen = new Set<string>();
  const valid = candidates.filter((candidate) => {
    if (!candidate.strategyId.trim() || seen.has(candidate.strategyId)) throw new Error("strategy ids must be unique");
    seen.add(candidate.strategyId);
    ratio(candidate.requestedWeight, "requestedWeight");
    if (!Number.isFinite(candidate.expectedReturn) || !Number.isFinite(candidate.risk) || candidate.risk < 0) throw new Error("candidate metrics are invalid");
    return candidate.expectedReturn > 0 && candidate.risk < 1;
  });
  const ordered = [...valid].sort((left, right) => (right.expectedReturn / Math.max(right.risk, 0.000001)) - (left.expectedReturn / Math.max(left.risk, 0.000001)) || left.strategyId.localeCompare(right.strategyId));
  let remaining = policy.maximumGrossWeight;
  const allocations: PortfolioAllocation[] = [];
  const rejected = candidates.filter((candidate) => !valid.includes(candidate)).map((candidate) => candidate.strategyId);
  for (const candidate of ordered) {
    const weight = Math.min(candidate.requestedWeight, policy.maximumStrategyWeight, remaining);
    if (weight > 0) allocations.push(Object.freeze({ strategyId: candidate.strategyId, weight }));
    remaining -= weight;
  }
  return Object.freeze({ allocations: Object.freeze(allocations), cashWeight: 1 - policy.maximumGrossWeight + remaining, rejectedStrategyIds: Object.freeze(rejected), reasons: Object.freeze(rejected.map((id) => `REJECTED_OR_UNATTRACTIVE:${id}`)), productionMutationAllowed: false as const });
};
