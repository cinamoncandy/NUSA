import { DefaultPortfolioLedger, type Portfolio } from "../../../packages/core/src/portfolio/portfolio";
import { filledExecutionReport } from "../../../packages/core/src/execution/executionReport";
import type { PaperOrder } from "../../desktop/src/paperBroker";

export interface TradeStatistics {
  readonly totalTrades: number;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly wins: number;
  readonly losses: number;
  /** null when no SELL has closed any position yet -- there is nothing to rate. */
  readonly winRate: number | null;
  readonly totalRealizedPnl: number;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly largestWin: number | null;
  readonly largestLoss: number | null;
}

// Large enough that a real historical fill (which, by definition, already succeeded against
// PaperBroker's own cash check) never spuriously fails DefaultPortfolioLedger's own check
// during replay.
const REPLAY_STARTING_CASH = Number.MAX_SAFE_INTEGER;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

/**
 * Derives trade-level statistics (win rate, average win/loss, ...) by replaying the account's
 * own fill history through the same, already-tested DefaultPortfolioLedger reducer the
 * reference accounting ledger uses (packages/core/src/portfolio/portfolio.ts) -- not a new,
 * separately-maintained arithmetic implementation. A realized-PnL delta only exists at a SELL
 * that closes some of the position, so wins/losses are counted there. `orders` must be
 * chronological oldest-first (PaperBroker's own snapshot().orders is newest-first -- reverse
 * before calling). Read-only reporting: never used to decide any trade.
 */
export function computeTradeStatistics(ordersOldestFirst: readonly PaperOrder[]): TradeStatistics {
  const ledger = new DefaultPortfolioLedger();
  let portfolio: Portfolio = { cash: REPLAY_STARTING_CASH, quantity: 0, averagePrice: 0, realizedPnl: 0 };
  const realizedDeltas: number[] = [];
  let buyCount = 0;
  let sellCount = 0;

  for (const order of ordersOldestFirst) {
    const report = filledExecutionReport({
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      fee: order.fee,
      symbol: order.market
    });
    const realizedBefore = portfolio.realizedPnl;
    const result = ledger.apply(portfolio, report);
    if (result.status !== "UPDATED") continue; // defensive only -- a real historical fill always replays cleanly
    portfolio = result.portfolio;
    if (order.side === "BUY") {
      buyCount += 1;
    } else {
      sellCount += 1;
      realizedDeltas.push(portfolio.realizedPnl - realizedBefore);
    }
  }

  const wins = realizedDeltas.filter((pnl) => pnl > 0);
  const losses = realizedDeltas.filter((pnl) => pnl < 0);

  return Object.freeze({
    totalTrades: ordersOldestFirst.length,
    buyCount,
    sellCount,
    wins: wins.length,
    losses: losses.length,
    winRate: realizedDeltas.length ? wins.length / realizedDeltas.length : null,
    totalRealizedPnl: sum(realizedDeltas),
    averageWin: average(wins),
    averageLoss: average(losses),
    largestWin: wins.length ? Math.max(...wins) : null,
    largestLoss: losses.length ? Math.min(...losses) : null
  });
}
