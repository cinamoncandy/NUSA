import type { TradePermissionResult } from "./tradePermissionEngine";

export type StrategyCapitalStatus = "RESEARCH" | "PAPER" | "SCALING" | "CHAMPION" | "SUSPENDED" | "RETIRED";
export type CapitalAllocationDecision = "ALLOCATE" | "REDUCE" | "REJECT";

export interface CapitalAllocationPolicy {
  readonly policyVersion: string;
  readonly fractionalKelly: number;
  readonly maximumPortfolioWeight: number;
  readonly maximumStrategyWeight: number;
  readonly minimumCashReserveWeight: number;
  readonly maximumCorrelation: number;
  readonly maximumRiskBudgetUsage: number;
  readonly maximumDrawdown: number;
  readonly dailyLossLimit: number;
  readonly monthlyLossLimit: number;
  readonly minimumAllocationUsd: number;
}

export interface CapitalAllocationInput {
  readonly allocationId: string;
  readonly generatedAt: string;
  readonly permission: TradePermissionResult;
  readonly strategyStatus: StrategyCapitalStatus;
  readonly totalEquityUsd: number;
  readonly availableCashUsd: number;
  readonly currentPortfolioGrossWeight: number;
  readonly currentStrategyWeight: number;
  readonly calibratedProbability: number;
  readonly expectedReward: number;
  readonly expectedLoss: number;
  readonly annualizedVolatility: number;
  readonly liquidityScore: number;
  readonly capacityUsd: number;
  readonly maximumPeerCorrelation: number;
  readonly riskBudgetUsage: number;
  readonly drawdown: number;
  readonly dailyReturn: number;
  readonly monthlyReturn: number;
  readonly killSwitchActive: boolean;
}

export interface CapitalAllocationResult {
  readonly allocationId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly decision: CapitalAllocationDecision;
  readonly targetWeight: number;
  readonly maximumWeight: number;
  readonly targetCapitalUsd: number;
  readonly cashReserveUsd: number;
  readonly kellyFraction: number;
  readonly drawdownMultiplier: number;
  readonly volatilityMultiplier: number;
  readonly liquidityMultiplier: number;
  readonly correlationMultiplier: number;
  readonly reasons: readonly string[];
  readonly policyVersion: string;
  readonly permissionDecisionId: string;
  readonly generatedAt: string;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const requireRatio = (value: number, label: string, allowNegative = false): void => {
  requireFinite(value, label);
  if (allowNegative) {
    if (value < -1 || value > 1) throw new Error(`${label} must be between -1 and 1`);
  } else if (value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
};

const validatePolicy = (policy: CapitalAllocationPolicy): void => {
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required");
  requireRatio(policy.fractionalKelly, "fractionalKelly");
  requireRatio(policy.maximumPortfolioWeight, "maximumPortfolioWeight");
  requireRatio(policy.maximumStrategyWeight, "maximumStrategyWeight");
  requireRatio(policy.minimumCashReserveWeight, "minimumCashReserveWeight");
  requireRatio(policy.maximumCorrelation, "maximumCorrelation");
  requireRatio(policy.maximumRiskBudgetUsage, "maximumRiskBudgetUsage");
  requireRatio(policy.maximumDrawdown, "maximumDrawdown");
  requireRatio(policy.dailyLossLimit, "dailyLossLimit");
  requireRatio(policy.monthlyLossLimit, "monthlyLossLimit");
  requireFinite(policy.minimumAllocationUsd, "minimumAllocationUsd");
  if (policy.minimumAllocationUsd < 0) throw new Error("minimumAllocationUsd must be non-negative");
  if (policy.minimumCashReserveWeight + policy.maximumPortfolioWeight > 1) {
    throw new Error("cash reserve and portfolio limits exceed total capital");
  }
};

const drawdownMultiplier = (drawdown: number, maximumDrawdown: number): number => {
  if (drawdown >= maximumDrawdown) return 0;
  const usage = maximumDrawdown === 0 ? 1 : drawdown / maximumDrawdown;
  if (usage >= 0.75) return 0.25;
  if (usage >= 0.5) return 0.5;
  if (usage >= 0.25) return 0.75;
  return 1;
};

const freezeResult = (result: CapitalAllocationResult): CapitalAllocationResult => {
  Object.freeze(result.reasons);
  return Object.freeze(result);
};

export const allocateCapital = (
  input: CapitalAllocationInput,
  policy: CapitalAllocationPolicy
): CapitalAllocationResult => {
  validatePolicy(policy);
  if (!input.allocationId.trim()) throw new Error("allocationId is required");
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("generatedAt must be a valid ISO timestamp");
  if (input.permission.expiresAt < input.generatedAt) throw new Error("trade permission is expired");
  if (input.permission.generatedAt > input.generatedAt) throw new Error("trade permission cannot be from the future");

  requireFinite(input.totalEquityUsd, "totalEquityUsd");
  requireFinite(input.availableCashUsd, "availableCashUsd");
  requireFinite(input.expectedReward, "expectedReward");
  requireFinite(input.expectedLoss, "expectedLoss");
  requireFinite(input.annualizedVolatility, "annualizedVolatility");
  requireFinite(input.capacityUsd, "capacityUsd");
  if (input.totalEquityUsd <= 0) throw new Error("totalEquityUsd must be positive");
  if (input.availableCashUsd < 0 || input.availableCashUsd > input.totalEquityUsd) throw new Error("availableCashUsd is invalid");
  if (input.expectedReward < 0 || input.expectedLoss <= 0) throw new Error("expected payoff is invalid");
  if (input.annualizedVolatility < 0 || input.capacityUsd < 0) throw new Error("volatility and capacity must be non-negative");

  requireRatio(input.currentPortfolioGrossWeight, "currentPortfolioGrossWeight");
  requireRatio(input.currentStrategyWeight, "currentStrategyWeight");
  requireRatio(input.calibratedProbability, "calibratedProbability");
  requireRatio(input.liquidityScore, "liquidityScore");
  requireRatio(input.maximumPeerCorrelation, "maximumPeerCorrelation");
  requireRatio(input.riskBudgetUsage, "riskBudgetUsage");
  requireRatio(input.drawdown, "drawdown");
  requireRatio(input.dailyReturn, "dailyReturn", true);
  requireRatio(input.monthlyReturn, "monthlyReturn", true);

  const reasons: string[] = [];
  const hardReject = (
    input.permission.decision !== "PERMIT"
    || input.strategyStatus === "RESEARCH"
    || input.strategyStatus === "PAPER"
    || input.strategyStatus === "SUSPENDED"
    || input.strategyStatus === "RETIRED"
    || input.killSwitchActive
    || input.riskBudgetUsage >= policy.maximumRiskBudgetUsage
    || input.drawdown >= policy.maximumDrawdown
    || input.dailyReturn <= -policy.dailyLossLimit
    || input.monthlyReturn <= -policy.monthlyLossLimit
  );

  if (input.permission.decision !== "PERMIT") reasons.push("TRADE_PERMISSION_REJECTED");
  if (input.strategyStatus === "RESEARCH" || input.strategyStatus === "PAPER") reasons.push("STRATEGY_NOT_CAPITAL_ELIGIBLE");
  if (input.strategyStatus === "SUSPENDED" || input.strategyStatus === "RETIRED") reasons.push("STRATEGY_INACTIVE");
  if (input.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  if (input.riskBudgetUsage >= policy.maximumRiskBudgetUsage) reasons.push("RISK_BUDGET_EXHAUSTED");
  if (input.drawdown >= policy.maximumDrawdown) reasons.push("MAX_DRAWDOWN_REACHED");
  if (input.dailyReturn <= -policy.dailyLossLimit) reasons.push("DAILY_LOSS_LIMIT_REACHED");
  if (input.monthlyReturn <= -policy.monthlyLossLimit) reasons.push("MONTHLY_LOSS_LIMIT_REACHED");

  const reserveUsd = round(input.totalEquityUsd * policy.minimumCashReserveWeight);
  if (hardReject) {
    return freezeResult({
      allocationId: input.allocationId,
      strategyId: input.permission.strategyId,
      market: input.permission.market,
      decision: "REJECT",
      targetWeight: 0,
      maximumWeight: 0,
      targetCapitalUsd: 0,
      cashReserveUsd: reserveUsd,
      kellyFraction: 0,
      drawdownMultiplier: 0,
      volatilityMultiplier: 0,
      liquidityMultiplier: 0,
      correlationMultiplier: 0,
      reasons: Object.freeze(reasons),
      policyVersion: policy.policyVersion,
      permissionDecisionId: input.permission.decisionId,
      generatedAt: input.generatedAt
    });
  }

  const winProbability = input.calibratedProbability;
  const lossProbability = 1 - winProbability;
  const payoffRatio = input.expectedReward / input.expectedLoss;
  const fullKelly = Math.max(0, winProbability - lossProbability / payoffRatio);
  const kellyFraction = clamp(fullKelly * policy.fractionalKelly);
  const ddMultiplier = drawdownMultiplier(input.drawdown, policy.maximumDrawdown);
  const volMultiplier = input.annualizedVolatility <= 0 ? 1 : clamp(0.25 / input.annualizedVolatility, 0.1, 1);
  const liquidityMultiplier = clamp(input.liquidityScore);
  const correlationMultiplier = input.maximumPeerCorrelation <= policy.maximumCorrelation
    ? 1
    : clamp(1 - (input.maximumPeerCorrelation - policy.maximumCorrelation));

  const statusMultiplier = input.strategyStatus === "CHAMPION" ? 1 : 0.5;
  const availablePortfolioWeight = Math.max(0, policy.maximumPortfolioWeight - input.currentPortfolioGrossWeight);
  const maximumWeight = Math.min(policy.maximumStrategyWeight, availablePortfolioWeight + input.currentStrategyWeight);
  const unconstrainedTarget = kellyFraction * ddMultiplier * volMultiplier * liquidityMultiplier * correlationMultiplier * statusMultiplier;
  const cashLimitedWeight = Math.max(0, (input.availableCashUsd - reserveUsd) / input.totalEquityUsd + input.currentStrategyWeight);
  const capacityWeight = input.capacityUsd / input.totalEquityUsd;
  const targetWeight = clamp(Math.min(unconstrainedTarget, maximumWeight, cashLimitedWeight, capacityWeight));
  const targetCapitalUsd = round(targetWeight * input.totalEquityUsd);

  if (targetCapitalUsd < policy.minimumAllocationUsd) {
    reasons.push("BELOW_MINIMUM_ALLOCATION");
    return freezeResult({
      allocationId: input.allocationId,
      strategyId: input.permission.strategyId,
      market: input.permission.market,
      decision: "REJECT",
      targetWeight: 0,
      maximumWeight: round(maximumWeight),
      targetCapitalUsd: 0,
      cashReserveUsd: reserveUsd,
      kellyFraction: round(kellyFraction),
      drawdownMultiplier: round(ddMultiplier),
      volatilityMultiplier: round(volMultiplier),
      liquidityMultiplier: round(liquidityMultiplier),
      correlationMultiplier: round(correlationMultiplier),
      reasons: Object.freeze(reasons),
      policyVersion: policy.policyVersion,
      permissionDecisionId: input.permission.decisionId,
      generatedAt: input.generatedAt
    });
  }

  if (ddMultiplier < 1) reasons.push("DRAWDOWN_GOVERNOR_APPLIED");
  if (volMultiplier < 1) reasons.push("VOLATILITY_LIMIT_APPLIED");
  if (correlationMultiplier < 1) reasons.push("CORRELATION_LIMIT_APPLIED");
  if (targetWeight < unconstrainedTarget) reasons.push("PORTFOLIO_OR_CAPACITY_LIMIT_APPLIED");
  if (input.strategyStatus === "SCALING") reasons.push("SCALING_CAPITAL_LIMIT_APPLIED");

  const decision: CapitalAllocationDecision = targetWeight < input.currentStrategyWeight ? "REDUCE" : "ALLOCATE";
  return freezeResult({
    allocationId: input.allocationId,
    strategyId: input.permission.strategyId,
    market: input.permission.market,
    decision,
    targetWeight: round(targetWeight),
    maximumWeight: round(maximumWeight),
    targetCapitalUsd,
    cashReserveUsd: reserveUsd,
    kellyFraction: round(kellyFraction),
    drawdownMultiplier: round(ddMultiplier),
    volatilityMultiplier: round(volMultiplier),
    liquidityMultiplier: round(liquidityMultiplier),
    correlationMultiplier: round(correlationMultiplier),
    reasons: Object.freeze(reasons),
    policyVersion: policy.policyVersion,
    permissionDecisionId: input.permission.decisionId,
    generatedAt: input.generatedAt
  });
};
