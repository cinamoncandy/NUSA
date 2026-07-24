/**
 * E02-T006 -- Portfolio (self-scoped: no formal ticket text was given, following E02-T002/
 * T003/T004/T005's conventions -- interface + Default* implementation, Result
 * discriminated union, fixed validation order, no exceptions), per the pipeline diagram:
 *   ... -> PaperExecutor -> ExecutionReport -> Portfolio -> PnL
 *
 * Pure domain module: a reducer applying one ExecutionReport to a Portfolio snapshot,
 * mirroring apps/desktop/src/paperBroker.ts's own BUY/SELL bookkeeping arithmetic
 * (cash/quantity/averagePrice/realizedPnl) as its own separately testable stage. This is
 * NOT a replacement for PaperBroker, which remains the single source of truth for this
 * app's real Paper account state -- it does not reproduce PaperBroker's fill model,
 * risk-policy checks, or quantity-step/dust handling. Wired only as an additional,
 * audit-only parallel reference alongside the real account (see
 * apps/server/src/pipeline/automaticTradingPipeline.ts), never to determine actual state.
 * No framework/database/network dependency; no async; no time or random values; inputs are
 * never mutated.
 */

import type { ExecutionReport } from "../execution/executionReport";

export interface Portfolio {
  readonly cash: number;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly realizedPnl: number;
}

export type PortfolioUpdateFailureCode =
  | "INVALID_PORTFOLIO"
  | "INVALID_EXECUTION_REPORT"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_POSITION";

export interface PortfolioUpdatedResult {
  readonly status: "UPDATED";
  readonly portfolio: Portfolio;
}

export interface PortfolioUpdateFailedResult {
  readonly status: "FAILED";
  readonly code: PortfolioUpdateFailureCode;
  readonly reason: string;
}

export type PortfolioUpdateResult = PortfolioUpdatedResult | PortfolioUpdateFailedResult;

export interface PortfolioLedger {
  apply(portfolio: Portfolio, report: ExecutionReport): PortfolioUpdateResult;
}

function updated(portfolio: Portfolio): PortfolioUpdatedResult {
  return { status: "UPDATED", portfolio };
}

function failed(code: PortfolioUpdateFailureCode, reason: string): PortfolioUpdateFailedResult {
  return { status: "FAILED", code, reason };
}

function isPortfolioValid(portfolio: Portfolio): boolean {
  return (
    Number.isFinite(portfolio.cash) && portfolio.cash >= 0 &&
    Number.isFinite(portfolio.quantity) && portfolio.quantity >= 0 &&
    Number.isFinite(portfolio.averagePrice) && portfolio.averagePrice >= 0 &&
    Number.isFinite(portfolio.realizedPnl)
  );
}

function isFilledReportValid(report: { quantity: number; price: number; fee: number; orderValue: number }): boolean {
  return (
    Number.isFinite(report.quantity) && report.quantity > 0 &&
    Number.isFinite(report.price) && report.price > 0 &&
    Number.isFinite(report.fee) && report.fee >= 0 &&
    Number.isFinite(report.orderValue) && report.orderValue > 0
  );
}

/**
 * Validation/computation order (fixed):
 *   1. portfolio is structurally valid (all fields finite; cash/quantity/averagePrice
 *      non-negative) -> else INVALID_PORTFOLIO
 *   2. a REJECTED report is a no-op -> return the portfolio unchanged
 *   3. a FILLED report's quantity/price/orderValue finite and positive, fee finite and
 *      non-negative -> else INVALID_EXECUTION_REPORT
 *   4. BUY: cash must cover orderValue + fee -> else INSUFFICIENT_CASH; averagePrice
 *      becomes the notional-weighted average of the existing and new position
 *   5. SELL: quantity must not exceed the current position -> else INSUFFICIENT_POSITION;
 *      realizedPnl += (price - averagePrice) * quantity - fee; averagePrice resets to 0
 *      once the resulting quantity is exactly 0
 * Only the first failing check is ever returned.
 */
export class DefaultPortfolioLedger implements PortfolioLedger {
  apply(portfolio: Portfolio, report: ExecutionReport): PortfolioUpdateResult {
    if (!isPortfolioValid(portfolio)) {
      return failed("INVALID_PORTFOLIO", "portfolio fields must be finite, with non-negative cash/quantity/averagePrice");
    }

    if (report.status === "REJECTED") return updated(portfolio);

    if (!isFilledReportValid(report)) {
      return failed("INVALID_EXECUTION_REPORT", "a FILLED report's quantity/price/orderValue must be finite and positive, and fee finite and non-negative");
    }

    if (report.side === "BUY") {
      const totalCost = report.orderValue + report.fee;
      if (totalCost > portfolio.cash) {
        return failed("INSUFFICIENT_CASH", `total cost (${totalCost}) exceeds available cash (${portfolio.cash})`);
      }
      const previousCost = portfolio.quantity * portfolio.averagePrice;
      const newQuantity = portfolio.quantity + report.quantity;
      return updated({
        cash: portfolio.cash - totalCost,
        quantity: newQuantity,
        averagePrice: (previousCost + report.orderValue) / newQuantity,
        realizedPnl: portfolio.realizedPnl
      });
    }

    if (report.quantity > portfolio.quantity) {
      return failed("INSUFFICIENT_POSITION", `sell quantity (${report.quantity}) exceeds current position (${portfolio.quantity})`);
    }
    const pnl = (report.price - portfolio.averagePrice) * report.quantity - report.fee;
    const newQuantity = portfolio.quantity - report.quantity;
    return updated({
      cash: portfolio.cash + report.orderValue - report.fee,
      quantity: newQuantity,
      averagePrice: newQuantity === 0 ? 0 : portfolio.averagePrice,
      realizedPnl: portfolio.realizedPnl + pnl
    });
  }
}
