import type { PortfolioRiskSummary } from "../../../packages/contracts/src/portfolioRiskIntelligence";

/**
 * Presentation model for portfolioRiskIntelligence.ts's PortfolioRiskSummary, following the same
 * pattern as aiTradingJudgmentPresentation.ts: a flat, pre-labeled view model with an explicit
 * UNAVAILABLE state, never a fabricated value. A metric portfolioRiskIntelligence itself reports
 * as null (insufficient evidence, e.g. no correlation/volatility data) renders as "-", the same as
 * an entirely missing summary -- this presentation layer must not invent precision the underlying
 * calculation does not have.
 */
export interface PortfolioRiskPresentation {
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly concentrationLabel: string;
  readonly largestPositionLabel: string;
  readonly grossExposureLabel: string;
  readonly netExposureLabel: string;
  readonly expectedRiskLabel: string;
  readonly currentDrawdownLabel: string;
  readonly maxCorrelationLabel: string;
  readonly insufficientEvidenceReasons: readonly string[];
}

const unavailable = (): PortfolioRiskPresentation => Object.freeze({
  status: "UNAVAILABLE",
  concentrationLabel: "-",
  largestPositionLabel: "-",
  grossExposureLabel: "-",
  netExposureLabel: "-",
  expectedRiskLabel: "-",
  currentDrawdownLabel: "-",
  maxCorrelationLabel: "-",
  insufficientEvidenceReasons: [],
});

function percentage(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function isFiniteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

/**
 * A PortfolioRiskSummary is normally produced by the validated contract calculator, but this
 * presentation model is also a trust boundary for callers and persisted/replayed data. Never
 * turn a malformed numeric value into a user-visible "NaN%" or "Infinity%".
 */
function isRenderableSummary(summary: PortfolioRiskSummary): boolean {
  return Number.isFinite(summary.equity)
    && summary.concentration != null
    && Number.isFinite(summary.concentration.herfindahlIndex)
    && Number.isFinite(summary.concentration.largestPositionWeight)
    && (summary.concentration.largestPositionMarket === null || typeof summary.concentration.largestPositionMarket === "string")
    && summary.exposure != null
    && Number.isFinite(summary.exposure.grossExposureRatio)
    && Number.isFinite(summary.exposure.netExposureRatio)
    && isFiniteOrNull(summary.expectedRisk)
    && isFiniteOrNull(summary.currentDrawdown)
    && isFiniteOrNull(summary.maxPairwiseCorrelation)
    && Array.isArray(summary.insufficientEvidenceReasons);
}

/**
 * Builds the portfolio risk presentation from a real PortfolioRiskSummary, or returns the
 * UNAVAILABLE state when there is none (no portfolio data yet, or the equity/assets required to
 * compute even concentration/exposure were unavailable upstream).
 */
export function buildPortfolioRiskPresentation(summary: PortfolioRiskSummary | null): PortfolioRiskPresentation {
  if (summary === null || !isRenderableSummary(summary)) return unavailable();
  return Object.freeze({
    status: "AVAILABLE",
    concentrationLabel: percentage(summary.concentration.herfindahlIndex),
    largestPositionLabel: summary.concentration.largestPositionMarket === null
      ? "-"
      : `${summary.concentration.largestPositionMarket} · ${ratio(summary.concentration.largestPositionWeight)}`,
    grossExposureLabel: ratio(summary.exposure.grossExposureRatio),
    netExposureLabel: ratio(summary.exposure.netExposureRatio),
    expectedRiskLabel: percentage(summary.expectedRisk),
    currentDrawdownLabel: percentage(summary.currentDrawdown),
    maxCorrelationLabel: summary.maxPairwiseCorrelation === null ? "-" : summary.maxPairwiseCorrelation.toFixed(2),
    insufficientEvidenceReasons: summary.insufficientEvidenceReasons,
  });
}
