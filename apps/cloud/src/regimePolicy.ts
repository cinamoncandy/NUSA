export type TradingRegime =
  | "STRONG_UPTREND"
  | "WEAK_UPTREND"
  | "SIDEWAYS"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "STRONG_DOWNTREND"
  | "WEAK_DOWNTREND";

export interface RegimeClassifierConfig {
  readonly trendLookback: number;
  readonly strongTrendReturn: number;
  readonly weakTrendReturn: number;
  readonly lowVolatility: number;
  readonly highVolatility: number;
}

export interface RegimeRiskProfile {
  readonly positionSizeMultiplier: number;
  readonly maximumExposureMultiplier: number;
  readonly dailyRiskMultiplier: number;
  readonly stopLossMultiplier: number;
  readonly takeProfitMultiplier: number;
  readonly orderFrequencyMultiplier: number;
}

export interface StrategyRegimeDecision {
  readonly strategyId: string;
  readonly regime: TradingRegime;
  readonly preference: "PREFERRED" | "NEUTRAL" | "FORBIDDEN";
  readonly allowNewExposure: boolean;
  readonly risk: RegimeRiskProfile;
  readonly reason: string;
}

export const DEFAULT_REGIME_CONFIG: RegimeClassifierConfig = Object.freeze({
  trendLookback: 20,
  strongTrendReturn: 0.04,
  weakTrendReturn: 0.01,
  lowVolatility: 0.001,
  highVolatility: 0.01
});

const assertFinitePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
};
const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values: readonly number[]): number => {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

export function classifyPriceRegime(prices: readonly number[], observedAt: number, config: RegimeClassifierConfig = DEFAULT_REGIME_CONFIG): TradingRegime | undefined {
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("observedAt must be a non-negative safe integer");
  if (!Number.isSafeInteger(config.trendLookback) || config.trendLookback < 2) throw new Error("trendLookback must be at least 2");
  assertFinitePositive(config.strongTrendReturn, "strongTrendReturn");
  assertFinitePositive(config.weakTrendReturn, "weakTrendReturn");
  assertFinitePositive(config.lowVolatility, "lowVolatility");
  assertFinitePositive(config.highVolatility, "highVolatility");
  if (config.strongTrendReturn <= config.weakTrendReturn || config.lowVolatility >= config.highVolatility) throw new Error("regime thresholds are invalid");
  if (prices.length < config.trendLookback + 1) return undefined;
  const window = prices.slice(-(config.trendLookback + 1));
  if (!window.every((price) => Number.isFinite(price) && price > 0)) throw new Error("prices must be positive and finite");
  const returns = window.slice(1).map((price, index) => price / window[index]! - 1);
  const totalReturn = window[window.length - 1]! / window[0]! - 1;
  const volatility = standardDeviation(returns);
  if (volatility >= config.highVolatility) return "HIGH_VOLATILITY";
  if (Math.abs(totalReturn) >= config.strongTrendReturn) return totalReturn > 0 ? "STRONG_UPTREND" : "STRONG_DOWNTREND";
  if (Math.abs(totalReturn) >= config.weakTrendReturn) return totalReturn > 0 ? "WEAK_UPTREND" : "WEAK_DOWNTREND";
  if (volatility <= config.lowVolatility) return "LOW_VOLATILITY";
  return "SIDEWAYS";
}

const profile = (positionSizeMultiplier: number, maximumExposureMultiplier: number, dailyRiskMultiplier: number, stopLossMultiplier: number, takeProfitMultiplier: number, orderFrequencyMultiplier: number): RegimeRiskProfile => Object.freeze({ positionSizeMultiplier, maximumExposureMultiplier, dailyRiskMultiplier, stopLossMultiplier, takeProfitMultiplier, orderFrequencyMultiplier });

export function evaluateStrategyRegime(strategyId: string, regime: TradingRegime): StrategyRegimeDecision {
  if (!strategyId) throw new Error("strategyId is required");
  const preferred = regime === "STRONG_UPTREND" || regime === "WEAK_UPTREND";
  const forbidden = regime === "STRONG_DOWNTREND" || regime === "HIGH_VOLATILITY";
  const risk = regime === "STRONG_UPTREND" ? profile(1, 1, 1, 1, 1, 1)
    : regime === "WEAK_UPTREND" ? profile(0.75, 0.75, 0.75, 1, 0.9, 0.75)
      : regime === "SIDEWAYS" || regime === "LOW_VOLATILITY" ? profile(0.5, 0.5, 0.5, 0.8, 0.8, 0.5)
        : regime === "HIGH_VOLATILITY" ? profile(0.25, 0.25, 0.25, 0.5, 0.75, 0.25)
          : regime === "WEAK_DOWNTREND" ? profile(0.25, 0.25, 0.25, 0.75, 0.75, 0.25)
            : profile(0, 0, 0, 0.5, 0.5, 0);
  return Object.freeze({ strategyId, regime, preference: preferred ? "PREFERRED" : forbidden ? "FORBIDDEN" : "NEUTRAL", allowNewExposure: !forbidden, risk, reason: forbidden ? "NEW_EXPOSURE_BLOCKED_BY_REGIME" : preferred ? "TREND_REGIME_SUPPORTED" : "REDUCED_REGIME_EXPOSURE" });
}
