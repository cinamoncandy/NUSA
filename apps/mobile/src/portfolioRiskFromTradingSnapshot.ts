/**
 * Bridges the real multi-position TradingSnapshot (tradingService.ts) into
 * summarizePortfolioRisk (packages/contracts/src/portfolioRiskIntelligence.ts).
 *
 * portfolioRiskIntelligence.ts was previously unwired: every existing mobile portfolio surface
 * (portfolioViewModel.ts's buildPortfolioViewModel, localPaperLedger.ts's buildLocalPortfolio)
 * collapses TradingSnapshot down to a single displayed position, even though TradingSnapshot
 * itself already carries positions: readonly Position[] -- multi-asset data has existed in this
 * app all along, it was just never fed into the concentration/exposure/risk-contribution
 * calculator. Wiring the HOME/PORTFOLIO screens themselves to actually *render* more than one
 * position is a separate, larger, visually-unverifiable-in-this-environment UI change (this
 * module does not attempt that); this module only makes the existing multi-position data usable
 * by the risk summary, so a screen can start showing it once that UI work happens.
 *
 * A position with no available mark price is dropped from the risk calculation rather than
 * assumed to be worth zero or fabricated a price -- consistent with portfolioRiskIntelligence's
 * own "return null/omit rather than fabricate" rule. Malformed position identity or quantity is
 * different from missing price evidence and is rejected fail-closed instead of being dropped.
 */
import type { TradingSnapshot } from "./tradingService";
import { summarizePortfolioRisk, type PortfolioRiskIntelligenceInput, type PortfolioRiskSummary } from "../../../packages/contracts/src/portfolioRiskIntelligence";

/** Returns the current mark price for a market, or null if unavailable. */
export type MarkPriceLookup = (market: string) => number | null;

export interface BuildPortfolioRiskSummaryOptions {
  readonly correlations?: PortfolioRiskIntelligenceInput["correlations"];
  readonly volatility?: PortfolioRiskIntelligenceInput["volatility"];
  readonly equityCurve?: PortfolioRiskIntelligenceInput["equityCurve"];
}

export interface PortfolioRiskFromTradingSnapshotResult {
  readonly summary: PortfolioRiskSummary;
  /** Markets present in the snapshot but dropped because no mark price was available for them. */
  readonly droppedMarkets: readonly string[];
}

function isFinitePrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function validatedPositionMarket(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw new Error("position market must be a non-empty trimmed string");
  }
  return value;
}

function validatedPositionQuantity(value: number, market: string): number {
  if (!Number.isFinite(value)) throw new Error(`position quantity must be finite: ${market}`);
  return value;
}

/**
 * Builds a PortfolioRiskSummary from a real TradingSnapshot, available cash, and a mark-price
 * lookup. Positions with no available mark price are excluded from both the asset list and the
 * equity total (never assumed to be worth zero) and reported in droppedMarkets instead.
 */
export function buildPortfolioRiskSummaryFromTradingSnapshot(
  trading: TradingSnapshot,
  cash: number,
  markPrice: MarkPriceLookup,
  options: BuildPortfolioRiskSummaryOptions = {},
): PortfolioRiskFromTradingSnapshotResult {
  if (!Number.isFinite(cash) || cash < 0) throw new Error("cash must be a non-negative finite number");

  const assets: PortfolioRiskIntelligenceInput["assets"][number][] = [];
  const droppedMarkets: string[] = [];

  for (const position of trading.positions) {
    const market = validatedPositionMarket(position.market);
    const quantity = validatedPositionQuantity(position.quantity, market);
    if (quantity === 0) continue;
    const price = markPrice(market);
    if (!isFinitePrice(price)) {
      droppedMarkets.push(market);
      continue;
    }
    assets.push({ market, marketValue: quantity * price });
  }

  const equity = cash + assets.reduce((sum, asset) => sum + asset.marketValue, 0);

  const summary = summarizePortfolioRisk({
    equity,
    assets: Object.freeze(assets),
    ...(options.correlations === undefined ? {} : { correlations: options.correlations }),
    ...(options.volatility === undefined ? {} : { volatility: options.volatility }),
    ...(options.equityCurve === undefined ? {} : { equityCurve: options.equityCurve }),
  });

  return { summary, droppedMarkets: Object.freeze(droppedMarkets) };
}
