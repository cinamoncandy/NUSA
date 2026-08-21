import type { PaperLedgerEntry, PaperOrder, PaperSide } from "./paperBroker";

/**
 * Derives the live rate/burst/exposure/loss-streak state that evaluatePreTradeRisk's
 * circuit breakers are checked against, from the broker's actual order and ledger
 * history. A caller that feeds these from anything other than real history (a
 * hardcoded 0, a stale cache) makes the corresponding limit unreachable regardless
 * of what the account actually did.
 */

export function tradingDayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function computeOrderRateState(
  orders: readonly PaperOrder[],
  nowMs: number,
  upcomingSide: PaperSide
): Readonly<{ ordersInLastSecond: number; ordersInLastMinute: number; sameSideStreak: number }> {
  let ordersInLastSecond = 0;
  let ordersInLastMinute = 0;
  for (const order of orders) {
    const age = nowMs - Date.parse(order.filledAt);
    if (age >= 0 && age < 1_000) ordersInLastSecond += 1;
    if (age >= 0 && age < 60_000) ordersInLastMinute += 1;
  }
  // orders is most-recent-first (PaperBroker.execute unshifts), so a run from the
  // front counts the unbroken streak of the same side leading up to this command.
  let sameSideStreak = 0;
  for (const order of orders) {
    if (order.side !== upcomingSide) break;
    sameSideStreak += 1;
  }
  return Object.freeze({ ordersInLastSecond, ordersInLastMinute, sameSideStreak });
}

export function computeDailyNotional(
  orders: readonly PaperOrder[],
  tradingDay: string
): Readonly<{ dailyBuyNotional: number; dailySellNotional: number }> {
  let dailyBuyNotional = 0;
  let dailySellNotional = 0;
  for (const order of orders) {
    if (tradingDayOf(order.filledAt) !== tradingDay) continue;
    const notional = order.quantity * order.price;
    if (order.side === "BUY") dailyBuyNotional += notional;
    else dailySellNotional += notional;
  }
  return Object.freeze({ dailyBuyNotional, dailySellNotional });
}

/**
 * Counts the unbroken run of losing closes ending at the most recent fill. Only SELL
 * fills realize P&L (PaperBroker never changes realizedPnl on a BUY), so a fill's own
 * P&L is the delta between its cumulative realizedPnlAfter and the one immediately
 * before it -- regardless of whether that prior fill was a BUY or a SELL.
 */
export function computeConsecutiveLossCount(ledger: readonly PaperLedgerEntry[]): number {
  let count = 0;
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    const entry = ledger[index];
    if (entry.side !== "SELL") continue;
    const priorRealizedPnl = index === 0 ? 0 : ledger[index - 1].realizedPnlAfter;
    const tradePnl = entry.realizedPnlAfter - priorRealizedPnl;
    if (tradePnl >= 0) break;
    count += 1;
  }
  return count;
}

export interface SessionPeakEquityTracker {
  /** Folds `equity` into the running peak and returns the peak (which is >= equity). */
  observe(equity: number): number;
}

export function createSessionPeakEquityTracker(initialPeakEquity: number): SessionPeakEquityTracker {
  let peak = Number.isFinite(initialPeakEquity) ? initialPeakEquity : 0;
  return Object.freeze({
    observe(equity: number): number {
      if (Number.isFinite(equity) && equity > peak) peak = equity;
      return peak;
    }
  });
}
