import { paperTradingDayKey } from "./paperTradingDay";
import type { PaperAccountPosition, PaperFillRecord } from "./paperTradingExecutionLoop";

/**
 * Display only: today's (Asia/Seoul) realized PAPER P&L in KRW, computed from the account's own fills for the owner's
 * app. It lives outside the RISK gateway on purpose (that source is pinned by requalification evidence) and uses the
 * same accounting the gateway uses for its daily figure: average entry price including buy fees, sell fee deducted,
 * only sells filled today count. It never feeds a decision. An inconsistent ledger (a sell larger than the position)
 * yields null rather than a guess.
 *
 * The PAPER state keeps only the newest fills. When older buys of a still-open position have been dropped, the average
 * entry would be rebuilt from the remaining buys only and the figure would be silently wrong. So the quantity rebuilt
 * from the retained fills must equal the account's own position quantity for every market; any mismatch yields null.
 */
const QUANTITY_TOLERANCE = 1e-9;

export function computeTodayRealizedPnlKrw(fills: readonly PaperFillRecord[], positions: readonly PaperAccountPosition[], now: number): number | null {
  if (!Number.isFinite(now)) return null;
  const rebuilt = new Map<string, { quantity: number; averageEntryPrice: number }>();
  const today = paperTradingDayKey(now);
  let realized = 0;
  for (const fill of [...fills].reverse().sort((a, b) => a.filledAt - b.filledAt)) {
    if (![fill.quantity, fill.price, fill.fee, fill.filledAt].every(Number.isFinite) || fill.quantity <= 0) return null;
    const prior = rebuilt.get(fill.market) ?? { quantity: 0, averageEntryPrice: 0 };
    if (fill.side === "BUY") {
      const quantity = prior.quantity + fill.quantity;
      rebuilt.set(fill.market, { quantity, averageEntryPrice: (prior.averageEntryPrice * prior.quantity + fill.quantity * fill.price + fill.fee) / quantity });
      continue;
    }
    if (fill.quantity > prior.quantity + Number.EPSILON) return null;
    const pnl = (fill.price - prior.averageEntryPrice) * fill.quantity - fill.fee;
    const quantity = Math.max(0, prior.quantity - fill.quantity);
    rebuilt.set(fill.market, { quantity, averageEntryPrice: quantity === 0 ? 0 : prior.averageEntryPrice });
    if (fill.filledAt <= now && paperTradingDayKey(fill.filledAt) === today) realized += pnl;
  }
  const held = new Map(positions.map((position) => [position.market, position.quantity]));
  for (const market of new Set([...held.keys(), ...rebuilt.keys()])) {
    const expected = held.get(market) ?? 0;
    const actual = rebuilt.get(market)?.quantity ?? 0;
    if (!Number.isFinite(expected) || Math.abs(expected - actual) > QUANTITY_TOLERANCE * Math.max(1, Math.abs(expected))) return null;
  }
  return Number.isFinite(realized) ? realized : null;
}
