/**
 * Risk Budget Projection: 11-category usage tracking for UI display.
 *
 * Each category is expressed as a ratio [0, 1]:
 *   - 0 = not using budget
 *   - 0.5 = half used
 *   - 1.0 = limit reached or exceeded
 *
 * Edge cases (prevent NaN/Infinity):
 *   - zero limit + zero usage = 0 (not NaN)
 *   - zero limit + positive usage = 1 (not Infinity)
 *   - positive limit + positive usage = usage/limit
 */

export interface PreTradeRiskRequest {
  readonly symbolExposure?: number;
  readonly portfolioExposure?: number;
  readonly dailyBuyNotional?: number;
  readonly dailySellNotional?: number;
  readonly openOrders?: number;
  readonly ordersPerSecond?: number;
  readonly ordersPerMinute?: number;
  readonly sameSideStreak?: number;
  readonly dailyLoss?: number;
  readonly consecutiveLosses?: number;
  readonly sessionDrawdown?: number;
}

export interface DesktopIndependentRiskLimits {
  readonly symbolExposure?: number;
  readonly portfolioExposure?: number;
  readonly dailyBuyNotional?: number;
  readonly dailySellNotional?: number;
  readonly maxOpenOrders?: number;
  readonly ordersPerSecond?: number;
  readonly ordersPerMinute?: number;
  readonly sameSideStreakLimit?: number;
  readonly maxDailyLoss?: number;
  readonly maxConsecutiveLosses?: number;
  readonly maxSessionDrawdown?: number;
}

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

function safeRatio(usage: number, limit: number | undefined): number {
  if (limit === undefined || limit === 0) {
    return usage > 0 ? 1 : 0;
  }
  if (usage < 0 || limit < 0) {
    return 0;
  }
  const ratio = usage / limit;
  return Math.min(1, Math.max(0, ratio));
}

export function projectRiskBudgetUsage(
  request: PreTradeRiskRequest,
  limits: DesktopIndependentRiskLimits
): RiskBudgetUsage {
  return Object.freeze({
    symbolExposure: safeRatio(request.symbolExposure ?? 0, limits.symbolExposure),
    portfolioExposure: safeRatio(request.portfolioExposure ?? 0, limits.portfolioExposure),
    dailyBuyNotional: safeRatio(request.dailyBuyNotional ?? 0, limits.dailyBuyNotional),
    dailySellNotional: safeRatio(request.dailySellNotional ?? 0, limits.dailySellNotional),
    openOrders: safeRatio(request.openOrders ?? 0, limits.maxOpenOrders),
    ordersPerSecond: safeRatio(request.ordersPerSecond ?? 0, limits.ordersPerSecond),
    ordersPerMinute: safeRatio(request.ordersPerMinute ?? 0, limits.ordersPerMinute),
    sameSideStreak: safeRatio(request.sameSideStreak ?? 0, limits.sameSideStreakLimit),
    dailyLoss: safeRatio(Math.max(0, request.dailyLoss ?? 0), limits.maxDailyLoss),
    consecutiveLosses: safeRatio(request.consecutiveLosses ?? 0, limits.maxConsecutiveLosses),
    sessionDrawdown: safeRatio(request.sessionDrawdown ?? 0, limits.maxSessionDrawdown)
  });
}
