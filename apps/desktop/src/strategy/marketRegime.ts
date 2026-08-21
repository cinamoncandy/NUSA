import { createHash } from "node:crypto";
import type { BacktestPoint } from "./backtestEngine";
import type { ResearchCandle } from "../cloud/researchDataset";

export type MarketTrendRegime = "UP_TREND" | "DOWN_TREND" | "RANGE" | "UNKNOWN";
export type MarketVolatilityRegime = "LOW_VOLATILITY" | "NORMAL_VOLATILITY" | "HIGH_VOLATILITY" | "UNKNOWN";
export type MarketLiquidityRegime = "LOW_LIQUIDITY" | "NORMAL_LIQUIDITY" | "HIGH_LIQUIDITY" | "UNKNOWN";

export interface RegimeClassifierConfig {
  readonly trendLookback: number;
  readonly volatilityLookback: number;
  readonly liquidityLookback: number;
  readonly trendThreshold: number;
  readonly lowVolatilityThreshold: number;
  readonly highVolatilityThreshold: number;
  readonly lowLiquidityThreshold: number;
  readonly highLiquidityThreshold: number;
  readonly minimumSamples: number;
  readonly classifierVersion: string;
}

export interface RegimeEvidence {
  readonly returnLookback?: number;
  readonly realizedVolatility?: number;
  readonly volumeRatio?: number;
}

export interface MarketRegime {
  readonly timestamp: number;
  readonly trend: MarketTrendRegime;
  readonly volatility: MarketVolatilityRegime;
  readonly liquidity: MarketLiquidityRegime;
  readonly confidence: number;
  readonly evidence: RegimeEvidence;
  readonly classifierVersion: string;
}

export interface RegimeAnnotatedPoint {
  readonly point: BacktestPoint;
  readonly regime: MarketRegime;
}

export interface RegimeTimeline {
  readonly classifierId: string;
  readonly classifierConfig: RegimeClassifierConfig;
  readonly points: readonly RegimeAnnotatedPoint[];
  readonly regimeCounts: Readonly<Record<string, number>>;
  readonly transitionCounts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function validateConfig(config: RegimeClassifierConfig): void {
  assertPositiveInteger("trendLookback", config.trendLookback);
  assertPositiveInteger("volatilityLookback", config.volatilityLookback);
  assertPositiveInteger("liquidityLookback", config.liquidityLookback);
  assertPositiveInteger("minimumSamples", config.minimumSamples);
  for (const [name, value] of Object.entries({ trendThreshold: config.trendThreshold, lowVolatilityThreshold: config.lowVolatilityThreshold, highVolatilityThreshold: config.highVolatilityThreshold, lowLiquidityThreshold: config.lowLiquidityThreshold, highLiquidityThreshold: config.highLiquidityThreshold })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
  }
  if (config.lowVolatilityThreshold > config.highVolatilityThreshold) throw new Error("volatility thresholds are inverted");
  if (config.lowLiquidityThreshold > config.highLiquidityThreshold) throw new Error("liquidity thresholds are inverted");
  if (!config.classifierVersion.trim()) throw new Error("classifierVersion is required");
}

function canonicalConfig(config: RegimeClassifierConfig): string {
  validateConfig(config);
  return JSON.stringify({
    trendLookback: config.trendLookback,
    volatilityLookback: config.volatilityLookback,
    liquidityLookback: config.liquidityLookback,
    trendThreshold: config.trendThreshold,
    lowVolatilityThreshold: config.lowVolatilityThreshold,
    highVolatilityThreshold: config.highVolatilityThreshold,
    lowLiquidityThreshold: config.lowLiquidityThreshold,
    highLiquidityThreshold: config.highLiquidityThreshold,
    minimumSamples: config.minimumSamples,
    classifierVersion: config.classifierVersion
  });
}

export function calculateRegimeClassifierId(config: RegimeClassifierConfig): string {
  return createHash("sha256").update(canonicalConfig(config), "utf8").digest("hex");
}

function logReturns(candles: readonly ResearchCandle[], start: number, endInclusive: number): readonly number[] {
  const returns: number[] = [];
  for (let index = start + 1; index <= endInclusive; index += 1) {
    const previous = candles[index - 1]!;
    const current = candles[index]!;
    returns.push(Math.log(current.close / previous.close));
  }
  return returns;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function classifyTrend(value: number | undefined, threshold: number): MarketTrendRegime {
  if (value == null) return "UNKNOWN";
  if (value > threshold) return "UP_TREND";
  if (value < -threshold) return "DOWN_TREND";
  return "RANGE";
}

function classifyVolatility(value: number | undefined, config: RegimeClassifierConfig): MarketVolatilityRegime {
  if (value == null) return "UNKNOWN";
  if (value < config.lowVolatilityThreshold) return "LOW_VOLATILITY";
  if (value > config.highVolatilityThreshold) return "HIGH_VOLATILITY";
  return "NORMAL_VOLATILITY";
}

function classifyLiquidity(value: number | undefined, config: RegimeClassifierConfig): MarketLiquidityRegime {
  if (value == null) return "UNKNOWN";
  if (value < config.lowLiquidityThreshold) return "LOW_LIQUIDITY";
  if (value > config.highLiquidityThreshold) return "HIGH_LIQUIDITY";
  return "NORMAL_LIQUIDITY";
}

function confidence(regime: Pick<MarketRegime, "trend" | "volatility" | "liquidity">): number {
  const known = [regime.trend, regime.volatility, regime.liquidity].filter((value) => value !== "UNKNOWN").length;
  return known / 3;
}

export function buildRegimeTimeline(candles: readonly ResearchCandle[], config: RegimeClassifierConfig): RegimeTimeline {
  validateConfig(config);
  if (candles.length === 0) throw new Error("regime timeline requires candles");
  const points: RegimeAnnotatedPoint[] = [];
  const regimeCounts: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  const warnings = new Set<string>();
  let previousKey: string | undefined;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (index > 0 && candle.closeTime <= candles[index - 1]!.closeTime) throw new Error("candles must be strictly ordered by closeTime");
    if (!Number.isFinite(candle.close) || candle.close <= 0) throw new Error("candle close must be positive and finite");

    const trendStart = index - config.trendLookback;
    const volatilityStart = index - config.volatilityLookback;
    const liquidityStart = index - config.liquidityLookback;

    const returnLookback = trendStart >= 0 && index >= config.minimumSamples
      ? Math.log(candle.close / candles[trendStart]!.close)
      : undefined;
    const realizedVolatility = volatilityStart >= 0 && index >= config.minimumSamples
      ? standardDeviation(logReturns(candles, volatilityStart, index))
      : undefined;
    const volumeRatio = liquidityStart >= 0 && index >= config.minimumSamples
      ? (() => {
          const history = candles.slice(liquidityStart, index);
          if (history.length === 0 || history.some((item) => !Number.isFinite(item.volume) || item.volume < 0)) return undefined;
          const mean = history.reduce((sum, item) => sum + item.volume, 0) / history.length;
          return mean > 0 ? candle.volume / mean : undefined;
        })()
      : undefined;

    if (returnLookback == null || realizedVolatility == null) warnings.add("INSUFFICIENT_LOOKBACK");
    if (volumeRatio == null) warnings.add("MISSING_VOLUME");

    const trend = classifyTrend(returnLookback, config.trendThreshold);
    const volatility = classifyVolatility(realizedVolatility, config);
    const liquidity = classifyLiquidity(volumeRatio, config);
    const regime = freeze({
      timestamp: candle.closeTime,
      trend,
      volatility,
      liquidity,
      confidence: confidence({ trend, volatility, liquidity }),
      evidence: freeze({ returnLookback, realizedVolatility, volumeRatio }),
      classifierVersion: config.classifierVersion
    });
    const point = freeze({ timestamp: candle.closeTime, close: candle.close });
    points.push(freeze({ point, regime }));

    const key = `${trend}|${volatility}|${liquidity}`;
    regimeCounts[key] = (regimeCounts[key] ?? 0) + 1;
    if (previousKey != null && previousKey !== key) {
      const transition = `${previousKey}->${key}`;
      transitionCounts[transition] = (transitionCounts[transition] ?? 0) + 1;
    }
    previousKey = key;
  }

  const unknownCount = points.filter((entry) => entry.regime.trend === "UNKNOWN" || entry.regime.volatility === "UNKNOWN" || entry.regime.liquidity === "UNKNOWN").length;
  if (unknownCount / points.length > 0.5) warnings.add("UNKNOWN_REGIME_DOMINATES");
  if (Object.values(transitionCounts).reduce((sum, count) => sum + count, 0) > Math.max(1, points.length / 2)) warnings.add("HIGH_TRANSITION_RATE");
  if (points.length < Math.max(config.trendLookback, config.volatilityLookback, config.liquidityLookback) + 1) warnings.add("SHORT_DATASET");

  return freeze({
    classifierId: calculateRegimeClassifierId(config),
    classifierConfig: freeze({ ...config }),
    points: Object.freeze(points),
    regimeCounts: freeze({ ...regimeCounts }),
    transitionCounts: freeze({ ...transitionCounts }),
    warnings: Object.freeze([...warnings])
  });
}
