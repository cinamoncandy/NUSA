import type { PaperAccountSnapshot } from "../../desktop/src/paperBroker";
import type { Portfolio } from "../../../packages/core/src/portfolio/portfolio";

/** Floating-point tolerance for comparing the real account against the reference ledger --
 * both are built from the same fills, but via independent arithmetic paths. */
const EPSILON = 1e-6;

export interface ReconciliationResult {
  readonly consistent: boolean;
  readonly discrepancies: readonly string[];
}

function diverges(real: number, reference: number): boolean {
  return Math.abs(real - reference) > EPSILON;
}

/**
 * Compares PaperBroker's real account (the sole source of truth) against the audit-only
 * reference Portfolio (packages/core, folded from the same ExecutionReports -- see
 * AutomaticTradingPipeline's ReferenceAccounting doc comment and PaperRuntime.placeOrder()).
 * Read-only reporting: a mismatch here is never corrected automatically and never feeds back
 * into any trading decision, only surfaced for the operator to notice.
 */
export function reconcileReferenceAccounting(account: PaperAccountSnapshot, portfolio: Portfolio): ReconciliationResult {
  const discrepancies: string[] = [];
  if (diverges(account.cash, portfolio.cash)) {
    discrepancies.push(`cash: real=${account.cash} reference=${portfolio.cash}`);
  }
  if (diverges(account.position.quantity, portfolio.quantity)) {
    discrepancies.push(`quantity: real=${account.position.quantity} reference=${portfolio.quantity}`);
  }
  if (diverges(account.position.realizedPnl, portfolio.realizedPnl)) {
    discrepancies.push(`realizedPnl: real=${account.position.realizedPnl} reference=${portfolio.realizedPnl}`);
  }
  // averagePrice is meaningless while flat -- both sides reset it to 0 independently, but not
  // necessarily at the exact same floating-point value on the way to zero, so skip it there.
  if (account.position.quantity !== 0 && diverges(account.position.averagePrice, portfolio.averagePrice)) {
    discrepancies.push(`averagePrice: real=${account.position.averagePrice} reference=${portfolio.averagePrice}`);
  }
  return Object.freeze({ consistent: discrepancies.length === 0, discrepancies: Object.freeze(discrepancies) });
}
