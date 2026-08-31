/**
 * Portfolio risk intelligence summary (NUSA governing charter section 32: "단순 보유 자산 목록
 * 금지" -- equity/return/risk contribution/concentration/correlation/drawdown/exposure/expected
 * risk, not just a holdings list).
 *
 * Every existing portfolio module found in this repository (paperPortfolioAdvisory.ts,
 * paperPortfolioRiskEvidence.ts, paperPortfolioPerformanceEvidence.ts, portfolioOrchestrator.ts)
 * is a research/promotion-evidence evaluator: "should this candidate strategy be added to or kept
 * in the League/portfolio". None of them compute a live risk/concentration summary of the
 * portfolio's *current holdings* the way apps/mobile/src/portfolioDomain.ts's PortfolioSummary
 * would need for the PORTFOLIO screen. This is intentionally a pure function of a plain asset list
 * (structurally compatible with -- not importing -- apps/mobile's Asset[]/PortfolioSummary, since
 * a package must not depend on an app) plus optional correlation/volatility/equity-curve inputs.
 *
 * Deliberately conservative: concentration and exposure need only the asset list and are always
 * computable. Correlation-based risk contribution, portfolio volatility (expected risk), and
 * drawdown each require their own additional evidence (a correlation matrix, per-asset
 * volatilities, an equity curve) and return null with a reason when that evidence is absent,
 * rather than fabricating a number. This mirrors the charter's "UNKNOWN != safe" rule and,
 * deliberately, does NOT synthesize an "AI assessment" narrative -- that belongs to the actual AI
 * pipeline (see aiTradingJudgment.ts), never invented by a calculator.
 */

export interface PortfolioRiskAssetInput {
  readonly market: string;
  /** Signed market value in the portfolio's quote currency; a short position may be negative. */
  readonly marketValue: number;
}

export interface PortfolioRiskIntelligenceInput {
  readonly equity: number;
  readonly assets: readonly PortfolioRiskAssetInput[];
  /** Optional: pairwise correlation in [-1, 1], keyed as "marketA|marketB" (order-independent). */
  readonly correlations?: Readonly<Record<string, number>>;
  /** Optional: per-asset return volatility (e.g. daily stdev), keyed by market. */
  readonly volatility?: Readonly<Record<string, number>>;
  /** Optional: chronological equity curve, oldest first, ending at the current equity. */
  readonly equityCurve?: readonly number[];
}

export interface PortfolioConcentration {
  /** Herfindahl-Hirschman Index over gross exposure weights, 0..1. Higher = more concentrated. */
  readonly herfindahlIndex: number;
  readonly largestPositionWeight: number;
  readonly largestPositionMarket: string | null;
}

export interface PortfolioExposure {
  /** Sum of |marketValue| / equity. 1.0 = fully invested with no leverage, unhedged. */
  readonly grossExposureRatio: number;
  /** Sum of signed marketValue / equity. Can be below 0 (net short) or above 1 (leveraged long). */
  readonly netExposureRatio: number;
  readonly perAssetWeight: Readonly<Record<string, number>>;
}

export interface PortfolioRiskContribution {
  readonly market: string;
  /** Share of total portfolio variance attributable to this asset, 0..1. */
  readonly contributionShare: number;
}

export interface PortfolioRiskSummary {
  readonly schemaVersion: 1;
  readonly equity: number;
  readonly concentration: PortfolioConcentration;
  readonly exposure: PortfolioExposure;
  /** null when correlations+volatility are insufficient to compute; see insufficientEvidenceReasons. */
  readonly riskContributions: readonly PortfolioRiskContribution[] | null;
  readonly maxPairwiseCorrelation: number | null;
  /** Portfolio-level volatility estimate; null when correlations+volatility are insufficient. */
  readonly expectedRisk: number | null;
  /** Peak-to-current drawdown from equityCurve, 0..1; null when no equity curve is supplied. */
  readonly currentDrawdown: number | null;
  readonly insufficientEvidenceReasons: readonly string[];
}

function correlationKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function computeConcentration(assets: readonly PortfolioRiskAssetInput[], grossTotal: number): PortfolioConcentration {
  if (grossTotal <= 0 || assets.length === 0) {
    return { herfindahlIndex: 0, largestPositionWeight: 0, largestPositionMarket: null };
  }
  let herfindahlIndex = 0;
  let largestPositionWeight = 0;
  let largestPositionMarket: string | null = null;
  for (const asset of assets) {
    const weight = Math.abs(asset.marketValue) / grossTotal;
    herfindahlIndex += weight * weight;
    if (weight > largestPositionWeight) {
      largestPositionWeight = weight;
      largestPositionMarket = asset.market;
    }
  }
  return { herfindahlIndex, largestPositionWeight, largestPositionMarket };
}

function computeExposure(assets: readonly PortfolioRiskAssetInput[], equity: number, grossTotal: number): PortfolioExposure {
  const perAssetWeight: Record<string, number> = {};
  let netTotal = 0;
  for (const asset of assets) {
    perAssetWeight[asset.market] = equity > 0 ? asset.marketValue / equity : 0;
    netTotal += asset.marketValue;
  }
  return {
    grossExposureRatio: equity > 0 ? grossTotal / equity : 0,
    netExposureRatio: equity > 0 ? netTotal / equity : 0,
    perAssetWeight: Object.freeze(perAssetWeight),
  };
}

function computeRiskContributions(
  assets: readonly PortfolioRiskAssetInput[],
  equity: number,
  correlations: Readonly<Record<string, number>>,
  volatility: Readonly<Record<string, number>>,
  reasons: string[],
): { contributions: readonly PortfolioRiskContribution[] | null; portfolioVolatility: number | null; maxCorrelation: number | null } {
  const missingVolatility = assets.filter((asset) => !(asset.market in volatility));
  if (missingVolatility.length > 0) {
    reasons.push(`VOLATILITY_MISSING:${missingVolatility.map((asset) => asset.market).join(",")}`);
    return { contributions: null, portfolioVolatility: null, maxCorrelation: null };
  }
  if (equity <= 0) {
    reasons.push("EQUITY_NON_POSITIVE");
    return { contributions: null, portfolioVolatility: null, maxCorrelation: null };
  }

  const weights = assets.map((asset) => asset.marketValue / equity);
  let variance = 0;
  let maxCorrelation: number | null = null;
  const marginalContribution: number[] = assets.map(() => 0);

  for (let i = 0; i < assets.length; i += 1) {
    for (let j = 0; j < assets.length; j += 1) {
      const volatilityI = volatility[assets[i].market];
      const volatilityJ = volatility[assets[j].market];
      const correlation = i === j ? 1 : (correlations[correlationKey(assets[i].market, assets[j].market)] ?? 0);
      if (i !== j) {
        if (maxCorrelation === null || Math.abs(correlation) > Math.abs(maxCorrelation)) maxCorrelation = correlation;
      }
      const term = weights[i] * weights[j] * volatilityI * volatilityJ * correlation;
      variance += term;
      marginalContribution[i] += weights[j] * volatilityI * volatilityJ * correlation;
    }
  }

  if (variance <= 0) {
    reasons.push("PORTFOLIO_VARIANCE_NON_POSITIVE");
    return { contributions: null, portfolioVolatility: null, maxCorrelation };
  }

  const portfolioVolatility = Math.sqrt(variance);
  const contributions = assets.map((asset, index) => ({
    market: asset.market,
    contributionShare: (weights[index] * marginalContribution[index]) / variance,
  }));

  return { contributions: Object.freeze(contributions), portfolioVolatility, maxCorrelation };
}

function computeDrawdown(equityCurve: readonly number[] | undefined, reasons: string[]): number | null {
  if (!equityCurve || equityCurve.length === 0) {
    reasons.push("EQUITY_CURVE_MISSING");
    return null;
  }
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }
  return maxDrawdown;
}

/**
 * Summarizes portfolio risk from a plain asset list plus whatever optional evidence is available.
 * Concentration and exposure are always computed; risk contribution / expected risk / drawdown
 * degrade to null with an explicit reason rather than a fabricated estimate when their required
 * inputs are missing.
 */
export function summarizePortfolioRisk(input: PortfolioRiskIntelligenceInput): PortfolioRiskSummary {
  const reasons: string[] = [];
  const grossTotal = input.assets.reduce((sum, asset) => sum + Math.abs(asset.marketValue), 0);

  const concentration = computeConcentration(input.assets, grossTotal);
  const exposure = computeExposure(input.assets, input.equity, grossTotal);

  let riskContributions: readonly PortfolioRiskContribution[] | null = null;
  let expectedRisk: number | null = null;
  let maxPairwiseCorrelation: number | null = null;
  if (input.assets.length === 0) {
    reasons.push("NO_ASSETS");
  } else if (!input.correlations || !input.volatility) {
    reasons.push("CORRELATIONS_OR_VOLATILITY_MISSING");
  } else {
    const result = computeRiskContributions(input.assets, input.equity, input.correlations, input.volatility, reasons);
    riskContributions = result.contributions;
    expectedRisk = result.portfolioVolatility;
    maxPairwiseCorrelation = result.maxCorrelation;
  }

  const currentDrawdown = computeDrawdown(input.equityCurve, reasons);

  return Object.freeze({
    schemaVersion: 1,
    equity: input.equity,
    concentration,
    exposure,
    riskContributions,
    maxPairwiseCorrelation,
    expectedRisk,
    currentDrawdown,
    insufficientEvidenceReasons: Object.freeze([...new Set(reasons)]),
  });
}
