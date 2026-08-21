import type { PreTradeRiskRequest } from "../../../../packages/contracts/src/riskGateway";
import type { IndependentRiskLimits } from "./independentRiskGateway";

export type DesktopIndependentRiskLimits = IndependentRiskLimits;

export interface RiskBudgetUsage {
  readonly symbolExposure: number;
  readonly portfolioExposure: number;
  readonly dailyBuyNotional: number;
  readonly dailySellNotional: number;
  readonly openOrders: number;
  readonly ordersPerSecond: number;
  readonly ordersPerMinute: number;
  readonly sameSideStreak: number;
  readonly dailyLoss: number;
  readonly consecutiveLosses: number;
  readonly sessionDrawdown: number;
}

function ratio(usage: number, limit: number): number {
  if (!Number.isFinite(usage) || usage < 0 || !Number.isFinite(limit) || limit < 0) return 1;
  if (limit === 0) return usage === 0 ? 0 : 1;
  return Math.min(1, usage / limit);
}

export function projectRiskBudgetUsage(
  request: PreTradeRiskRequest,
  limits: DesktopIndependentRiskLimits
): RiskBudgetUsage {
  const drawdown = request.sessionState.sessionPeakEquity <= 0
    ? request.sessionState.sessionEquity < request.sessionState.sessionPeakEquity ? 1 : 0
    : Math.max(0, (request.sessionState.sessionPeakEquity - request.sessionState.sessionEquity) / request.sessionState.sessionPeakEquity);
  return Object.freeze({
    symbolExposure: ratio(request.exposureState.symbolExposureNotional, limits.maxSymbolExposureNotional),
    portfolioExposure: ratio(request.exposureState.portfolioExposureNotional, limits.maxPortfolioExposureNotional),
    dailyBuyNotional: ratio(request.exposureState.dailyBuyNotional, limits.maxDailyBuyNotional),
    dailySellNotional: ratio(request.exposureState.dailySellNotional, limits.maxDailySellNotional),
    openOrders: ratio(request.accountState.openOrderCount, limits.maxOpenOrders),
    ordersPerSecond: ratio(request.rateState.ordersInLastSecond, limits.maxOrdersPerSecond),
    ordersPerMinute: ratio(request.rateState.ordersInLastMinute, limits.maxOrdersPerMinute),
    sameSideStreak: ratio(request.rateState.sameSideStreak, limits.maxSameSideStreak),
    dailyLoss: ratio(Math.max(0, -request.sessionState.dailyRealizedPnL), limits.maxDailyLoss),
    consecutiveLosses: ratio(request.sessionState.consecutiveLossCount, limits.maxConsecutiveLosses),
    sessionDrawdown: ratio(drawdown, limits.maxSessionDrawdownRatio)
  });
}
