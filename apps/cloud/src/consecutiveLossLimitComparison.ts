import { paperTradingDayKey } from "./paperTradingDay";

/**
 * Offline, read-only comparison of consecutive-loss limits over a recorded sequence of completed
 * PAPER sells (issue 2575 item 5). It changes no threshold and feeds no decision. It is a
 * counterfactual over a fixed sequence: a blocked sell is assumed never to have happened, and the
 * path-dependence of positions after a block is NOT modelled. Treat the output as a screening
 * comparison, never as promotion evidence.
 *
 * CENSORING: a ledger recorded under limit L never contains the sells the runtime blocked after the
 * L-th consecutive loss, so a limit above L cannot recover their outcomes from that ledger alone and
 * would look identical to L. Results for limit > `recordedUnderLimit` are therefore flagged
 * `censored: true` and must not be read as evidence; they need uncensored shadow/replay outcomes.
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
  /** True when the input ledger was recorded under a lower limit, so this limit cannot be evaluated from it. */
  readonly censored: boolean;
}

export interface ConsecutiveLossComparisonOptions {
  /** The limit the runtime enforced while the sells were recorded (the runtime limit is 3). */
  readonly recordedUnderLimit?: number;
}

function validTimestamp(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  try { paperTradingDayKey(value); return true; } catch { return false; }
}

export function compareConsecutiveLossLimits(sells: readonly CompletedPaperSell[], limits: readonly number[], options: ConsecutiveLossComparisonOptions = {}): readonly ConsecutiveLossLimitResult[] {
  const recordedUnderLimit = options.recordedUnderLimit ?? 3;
  const seen = new Map<string, CompletedPaperSell>();
  const ordered: CompletedPaperSell[] = [];
  for (const sell of sells) {
    if (!validTimestamp(sell.completedAt) || !Number.isFinite(sell.netPnl) || sell.orderId === "") continue;
    const earlier = seen.get(sell.orderId);
    if (earlier !== undefined) {
      // An identical duplicate never counts twice; a conflicting one makes the export untrustworthy, so fail rather than pick by input order.
      if (earlier.completedAt !== sell.completedAt || earlier.netPnl !== sell.netPnl) throw new Error(`conflicting records for order ${sell.orderId}`);
      continue;
    }
    seen.set(sell.orderId, sell);
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
    return Object.freeze({ limit, tradeCount, blockedCount, netPnl, maxDrawdown, pnlWhileStreakAtOrAboveThree: pnlWhileStreak, opportunityLoss, avoidedLoss, censored: limit > recordedUnderLimit });
  });
}
