/**
 * E02-T007 -- PnL (self-scoped, same conventions as the rest of the E02 series), per the
 * pipeline diagram: ... -> Portfolio -> PnL
 *
 * Pure domain module: given a Portfolio and a mark price, computes unrealized and total
 * PnL. realizedPnl is already tracked on Portfolio itself
 * (../portfolio/portfolio.ts) -- this module only adds the mark-to-market unrealized
 * figure and the combined total. Same "reference implementation, not a replacement for
 * PaperBroker" scope as Portfolio. No framework/database/network dependency; no async; no
 * time or random values; inputs are never mutated.
 */

import type { Portfolio } from "../portfolio/portfolio";

export interface PnLSnapshot {
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalPnl: number;
}

export type PnLFailureCode = "INVALID_PORTFOLIO" | "INVALID_MARK_PRICE";

export interface PnLCalculatedResult {
  readonly status: "CALCULATED";
  readonly pnl: PnLSnapshot;
}

export interface PnLFailedResult {
  readonly status: "FAILED";
  readonly code: PnLFailureCode;
  readonly reason: string;
}

export type PnLResult = PnLCalculatedResult | PnLFailedResult;

export interface PnLCalculator {
  calculate(portfolio: Portfolio, markPrice: number): PnLResult;
}

/**
 * Validation order (fixed):
 *   1. portfolio.quantity/averagePrice/realizedPnl finite (quantity/averagePrice
 *      non-negative) -> else INVALID_PORTFOLIO
 *   2. markPrice finite and positive -> else INVALID_MARK_PRICE
 *   3. unrealizedPnl = quantity * (markPrice - averagePrice); totalPnl = realizedPnl +
 *      unrealizedPnl
 */
export class DefaultPnLCalculator implements PnLCalculator {
  calculate(portfolio: Portfolio, markPrice: number): PnLResult {
    if (
      !Number.isFinite(portfolio.quantity) || portfolio.quantity < 0 ||
      !Number.isFinite(portfolio.averagePrice) || portfolio.averagePrice < 0 ||
      !Number.isFinite(portfolio.realizedPnl)
    ) {
      return { status: "FAILED", code: "INVALID_PORTFOLIO", reason: "portfolio fields must be finite, with non-negative quantity/averagePrice" };
    }
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return { status: "FAILED", code: "INVALID_MARK_PRICE", reason: "markPrice must be finite and positive" };
    }
    const unrealizedPnl = portfolio.quantity * (markPrice - portfolio.averagePrice);
    return {
      status: "CALCULATED",
      pnl: { realizedPnl: portfolio.realizedPnl, unrealizedPnl, totalPnl: portfolio.realizedPnl + unrealizedPnl }
    };
  }
}
