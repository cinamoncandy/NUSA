import { paperTradingDayKey } from "./paperTradingDay";

/**
 * Offline, read-only comparison of consecutive-loss limits over a recorded sequence of completed
 * PAPER sells (issue 2575 item 5). It changes no threshold and feeds no decision. It is a
 * counterfactual over a fixed sequence: a blocked sell is assumed never to have happened, and the
 * path-dependence of positions after a block is NOT modelled. Treat the output as a screening
 * comparison, never as promotion evidence.
 */
export interface CompletedPaperSell {
  readonly orderId: string;
  readonly completedAt: number;
  /** Realized PnL after fees and slippage, in quote currency. */
  readonly netPnl: number;
}

export interface ConsecutiveLossLimitResult {
  readonly limit: number;
  readonly tradeCount: number;
  readonly blockedCount: number;
  readonly netPnl: number;
  readonly maxDrawdown: number;
  /** Net PnL of allowed sells made while the day's loss streak was already >= 3. */
  readonly pnlWhileStreakAtOrAboveThree: number;
  /** Sum of positive PnL of blocked sells (what the cap gave up). */
  readonly opportunityLoss: number;
  /** Sum of the magnitude of negative PnL of blocked sells (what the cap avoided). */
  readonly avoidedLoss: number;
}

export function compareConsecutiveLossLimits(sells: readonly CompletedPaperSell[], limits: readonly number[]): readonly ConsecutiveLossLimitResult[] {
  const seen = new Set<string>();
  const ordered: CompletedPaperSell[] = [];
  for (const sell of sells) {
    if (!Number.isFinite(sell.completedAt) || !Number.isFinite(sell.netPnl) || sell.orderId === "") continue;
    if (seen.has(sell.orderId)) continue; // a duplicate fill never counts twice
    seen.add(sell.orderId);
    ordered.push(sell);
  }
  ordered.sort((a, b) => a.completedAt - b.completedAt || (a.orderId < b.orderId ? -1 : 1));
  return limits.map((limit) => {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("consecutive-loss limit must be a positive integer");
    let day = "";
    let streak = 0;
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let netPnl = 0, pnlWhileStreak = 0, opportunityLoss = 0, avoidedLoss = 0, tradeCount = 0, blockedCount = 0;
    for (const sell of ordered) {
      const key = paperTradingDayKey(sell.completedAt);
      if (key !== day) { day = key; streak = 0; }
      if (streak >= limit) {
        blockedCount += 1;
        if (sell.netPnl > 0) opportunityLoss += sell.netPnl; else avoidedLoss += -sell.netPnl;
        continue;
      }
      if (streak >= 3) pnlWhileStreak += sell.netPnl;
      tradeCount += 1;
      netPnl += sell.netPnl;
      equity += sell.netPnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
      streak = sell.netPnl < 0 ? streak + 1 : 0;
    }
    return Object.freeze({ limit, tradeCount, blockedCount, netPnl, maxDrawdown, pnlWhileStreakAtOrAboveThree: pnlWhileStreak, opportunityLoss, avoidedLoss });
  });
}
