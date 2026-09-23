import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperCandidateStrategyDecision } from "./cioDecisionEngine";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

const SMA_FAMILY = "sma-crossover";
const RSI_FAMILY = "rsi-mean-reversion";
const DONCHIAN_FAMILY = "donchian-breakout";
const VOLATILITY_COMPRESSION_FAMILY = "volatility-compression-breakout";
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSmaParameters(spec: PaperCandidateStrategySpec): { shortPeriod: number; longPeriod: number } {
  const parameters = spec.parameters;
  const shortPeriod = parameters.shortPeriod;
  const longPeriod = parameters.longPeriod;
  if (!finitePositiveInteger(shortPeriod) || !finitePositiveInteger(longPeriod) || shortPeriod >= longPeriod || longPeriod > 500) {
    throw new Error("PAPER SMA candidate parameters are invalid");
  }
  return { shortPeriod, longPeriod };
}

function parseDonchianParameters(spec: PaperCandidateStrategySpec): { channelPeriod: number } {
  const channelPeriod = spec.parameters.channelPeriod;
  if (!finitePositiveInteger(channelPeriod) || channelPeriod < 2 || channelPeriod > 500) {
    throw new Error("PAPER Donchian candidate parameters are invalid");
  }
  return { channelPeriod };
}

function parseVolatilityCompressionParameters(spec: PaperCandidateStrategySpec): { breakoutLookback: number; compressionRatio: number } {
  const breakoutLookback = spec.parameters.breakoutLookback;
  const compressionRatio = spec.parameters.compressionRatio;
  if (
    !finitePositiveInteger(breakoutLookback) || breakoutLookback < 2 || breakoutLookback > 500
    || typeof compressionRatio !== "number" || !Number.isFinite(compressionRatio)
    || compressionRatio <= 0 || compressionRatio > 1
  ) {
    throw new Error("PAPER volatility compression candidate parameters are invalid");
  }
  return { breakoutLookback, compressionRatio };
}

function parseRsiParameters(spec: PaperCandidateStrategySpec): { period: number; oversold: number; overbought: number } {
  const parameters = spec.parameters;
  const period = parameters.period;
  const oversold = parameters.oversold;
  const overbought = parameters.overbought;
  if (
    !finitePositiveInteger(period) || period < 2 || period > 500
    || typeof oversold !== "number" || !Number.isFinite(oversold)
    || typeof overbought !== "number" || !Number.isFinite(overbought)
    || !(oversold > 0 && oversold < overbought && overbought < 100)
  ) {
    throw new Error("PAPER RSI candidate parameters are invalid");
  }
  return { period, oversold, overbought };
}

function canonicalPrices(
  observations: readonly IntelligenceObservation[],
  now: number,
  market?: string,
): readonly (readonly [number, number])[] {
  const points = observations
    .filter((item) => market == null || item.market?.trim().toUpperCase() === market.trim().toUpperCase())
    .filter((item) => item.source === "CHART" && item.price !== undefined && Number.isFinite(item.price) && item.price > 0 && item.observedAt <= now)
    .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id));
  const unique = new Map<number, number>();
  for (const point of points) unique.set(point.observedAt, point.price!);
  return Object.freeze([...unique.entries()].sort(([left], [right]) => left - right));
}

function rsi(closes: readonly number[], period: number): number | undefined {
  if (closes.length < period + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function evaluateSma(
  spec: PaperCandidateStrategySpec,
  prices: readonly (readonly [number, number])[],
  now: number,
): PaperCandidateStrategyDecision {
  const { shortPeriod, longPeriod } = parseSmaParameters(spec);
  if (prices.length < longPeriod) {
    return Object.freeze({ action: "WAIT", score: 0, confidence: 0, observedAt: prices.at(-1)?.[0] ?? now, reason: `INSUFFICIENT_SMA_OBSERVATIONS:${prices.length}/${longPeriod}` });
  }
  const recent = prices.slice(-longPeriod);
  const short = recent.slice(-shortPeriod).reduce((sum, [, price]) => sum + price, 0) / shortPeriod;
  const long = recent.reduce((sum, [, price]) => sum + price, 0) / longPeriod;
  const score = round4(clamp((short - long) / Math.max(long, Number.EPSILON) * 100, -1, 1));
  const confidence = round4(clamp(prices.length / (longPeriod * 2), 0, 1));
  const observedAt = recent.at(-1)![0];
  const action = confidence < 0.5 ? "WAIT" : score > 0 ? "BUY" : score < 0 ? "SELL" : "HOLD";
  return Object.freeze({ action, score, confidence, observedAt, reason: `SMA_CROSSOVER:${shortPeriod}/${longPeriod}:short=${round4(short)}:long=${round4(long)}` });
}

function donchianPosition(closes: readonly number[], channelPeriod: number): { position: -1 | 0 | 1; highest: number; lowest: number } | undefined {
  if (closes.length < channelPeriod + 1) return undefined;
  const current = closes.at(-1)!;
  const channel = closes.slice(-(channelPeriod + 1), -1);
  const highest = Math.max(...channel);
  const lowest = Math.min(...channel);
  const position: -1 | 0 | 1 = current > highest ? 1 : current < lowest ? -1 : 0;
  return { position, highest, lowest };
}

function evaluateDonchian(
  spec: PaperCandidateStrategySpec,
  prices: readonly (readonly [number, number])[],
  now: number,
): PaperCandidateStrategyDecision {
  const { channelPeriod } = parseDonchianParameters(spec);
  const closes = prices.map(([, price]) => price);
  const current = donchianPosition(closes, channelPeriod);
  if (current === undefined) {
    return Object.freeze({ action: "WAIT", score: 0, confidence: 0, observedAt: prices.at(-1)?.[0] ?? now, reason: `INSUFFICIENT_DONCHIAN_OBSERVATIONS:${prices.length}/${channelPeriod + 1}` });
  }
  const observedAt = prices.at(-1)?.[0] ?? now;
  const prior = donchianPosition(closes.slice(0, -1), channelPeriod);
  if (prior === undefined) {
    return Object.freeze({ action: "HOLD", score: 0, confidence: 0, observedAt, reason: `DONCHIAN_BREAKOUT:${channelPeriod}:baseline=${current.position}:high=${round4(current.highest)}:low=${round4(current.lowest)}` });
  }
  const range = current.highest - current.lowest;
  const latest = closes.at(-1)!;
  const confidence = round4(range > 0 ? clamp(Math.abs(latest - (current.highest + current.lowest) / 2) / range, 0, 1) : 0);
  let action: PaperCandidateStrategyDecision["action"] = "HOLD";
  if (prior.position <= 0 && current.position === 1) action = "BUY";
  else if (prior.position >= 0 && current.position === -1) action = "SELL";
  const score = action === "BUY" ? confidence : action === "SELL" ? -confidence : 0;
  return Object.freeze({
    action, score, confidence, observedAt,
    reason: `DONCHIAN_BREAKOUT:${channelPeriod}:prior=${prior.position}:current=${current.position}:high=${round4(current.highest)}:low=${round4(current.lowest)}`,
  });
}

function evaluateRsi(
  spec: PaperCandidateStrategySpec,
  prices: readonly (readonly [number, number])[],
  now: number,
): PaperCandidateStrategyDecision {
  const { period, oversold, overbought } = parseRsiParameters(spec);
  const closes = prices.map(([, price]) => price);
  const current = rsi(closes, period);
  if (current === undefined) {
    return Object.freeze({ action: "WAIT", score: 0, confidence: 0, observedAt: prices.at(-1)?.[0] ?? now, reason: `INSUFFICIENT_RSI_OBSERVATIONS:${prices.length}/${period + 1}` });
  }
  const prior = rsi(closes.slice(0, -1), period);
  const observedAt = prices.at(-1)?.[0] ?? now;
  if (prior === undefined) {
    return Object.freeze({ action: "HOLD", score: 0, confidence: 0, observedAt, reason: `RSI_MEAN_REVERSION:${period}:${round4(oversold)}/${round4(overbought)}:baseline=${round4(current)}` });
  }
  const confidence = round4(clamp(Math.abs(current - 50) / 50, 0, 1));
  let action: PaperCandidateStrategyDecision["action"] = "HOLD";
  if (prior <= oversold && current > oversold) action = "BUY";
  else if (prior >= overbought && current < overbought) action = "SELL";
  const score = action === "BUY" ? confidence : action === "SELL" ? -confidence : 0;
  return Object.freeze({
    action, score, confidence, observedAt,
    reason: `RSI_MEAN_REVERSION:${period}:${round4(oversold)}/${round4(overbought)}:prior=${round4(prior)}:current=${round4(current)}`,
  });
}

function populationStd(values: readonly number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

type VolatilityCompressionState = Readonly<{
  position: -1 | 0 | 1;
  compressed: boolean;
  volatilityAvailable: boolean;
  volRatio: number;
  highest: number;
  lowest: number;
}>;

function volatilityCompressionState(
  closesIncludingCurrent: readonly number[],
  breakoutLookback: number,
  compressionRatio: number,
): VolatilityCompressionState | undefined {
  const priorCloses = closesIncludingCurrent.slice(0, -1);
  const requiredPriorCloses = Math.max(breakoutLookback, 31);
  if (priorCloses.length < requiredPriorCloses) return undefined;
  const volCloses = priorCloses.slice(-31);
  const returns = volCloses.slice(1).map((close, index) => close / volCloses[index]! - 1);
  const longVol = populationStd(returns);
  const shortVol = populationStd(returns.slice(-5));
  const channel = priorCloses.slice(-breakoutLookback);
  const highest = Math.max(...channel);
  const lowest = Math.min(...channel);
  if (!Number.isFinite(longVol) || !Number.isFinite(shortVol) || longVol <= Number.EPSILON) {
    return Object.freeze({ position: 0, compressed: false, volatilityAvailable: false, volRatio: Number.POSITIVE_INFINITY, highest, lowest });
  }
  const volRatio = shortVol / longVol;
  const compressed = Number.isFinite(volRatio) && volRatio <= compressionRatio;
  const current = closesIncludingCurrent.at(-1)!;
  const rawPosition: -1 | 0 | 1 = current > highest ? 1 : current < lowest ? -1 : 0;
  return Object.freeze({ position: compressed ? rawPosition : 0, compressed, volatilityAvailable: true, volRatio, highest, lowest });
}

function evaluateVolatilityCompression(
  spec: PaperCandidateStrategySpec,
  prices: readonly (readonly [number, number])[],
  now: number,
): PaperCandidateStrategyDecision {
  const { breakoutLookback, compressionRatio } = parseVolatilityCompressionParameters(spec);
  const closes = prices.map(([, price]) => price);
  const current = volatilityCompressionState(closes, breakoutLookback, compressionRatio);
  if (current === undefined) {
    const required = Math.max(breakoutLookback, 31) + 1;
    return Object.freeze({ action: "WAIT", score: 0, confidence: 0, observedAt: prices.at(-1)?.[0] ?? now, reason: `INSUFFICIENT_VOLATILITY_COMPRESSION_OBSERVATIONS:${prices.length}/${required}` });
  }
  const observedAt = prices.at(-1)?.[0] ?? now;
  if (!current.volatilityAvailable) {
    return Object.freeze({ action: "HOLD", score: 0, confidence: 0, observedAt, reason: `VOLATILITY_COMPRESSION_BREAKOUT:${breakoutLookback}/${round4(compressionRatio)}:volatility-baseline-unavailable` });
  }
  const prior = volatilityCompressionState(closes.slice(0, -1), breakoutLookback, compressionRatio);
  if (prior === undefined) {
    return Object.freeze({ action: "HOLD", score: 0, confidence: 0, observedAt, reason: `VOLATILITY_COMPRESSION_BREAKOUT:${breakoutLookback}/${round4(compressionRatio)}:baseline=${current.position}:ratio=${round4(current.volRatio)}` });
  }
  let action: PaperCandidateStrategyDecision["action"] = "HOLD";
  if (prior.position <= 0 && current.position === 1) action = "BUY";
  else if (prior.position >= 0 && current.position === -1) action = "SELL";
  const range = current.highest - current.lowest;
  const latest = closes.at(-1)!;
  const boundary = current.position === 1 ? current.highest : current.position === -1 ? current.lowest : latest;
  const breakoutStrength = range > 0 ? clamp(Math.abs(latest - boundary) / range, 0, 1) : 0;
  const compressionStrength = clamp((compressionRatio - current.volRatio) / compressionRatio, 0, 1);
  const confidence = action === "HOLD" ? 0 : round4(clamp(breakoutStrength * 0.7 + compressionStrength * 0.3, 0, 1));
  const score = action === "BUY" ? confidence : action === "SELL" ? -confidence : 0;
  return Object.freeze({
    action, score, confidence, observedAt,
    reason: `VOLATILITY_COMPRESSION_BREAKOUT:${breakoutLookback}/${round4(compressionRatio)}:prior=${prior.position}:current=${current.position}:ratio=${round4(current.volRatio)}`,
  });
}

/**
 * Evaluates exact immutable Research candidate semantics over already accepted public ticker
 * observations. It is deterministic and read-only: generic CIO scoring is never a fallback.
 */
export function evaluatePaperCandidateStrategy(
  spec: PaperCandidateStrategySpec,
  observations: readonly IntelligenceObservation[],
  now: number,
  market?: string,
): PaperCandidateStrategyDecision {
  const prices = canonicalPrices(observations, now, market);
  if (spec.familyId === SMA_FAMILY) return evaluateSma(spec, prices, now);
  if (spec.familyId === RSI_FAMILY) return evaluateRsi(spec, prices, now);
  if (spec.familyId === DONCHIAN_FAMILY) return evaluateDonchian(spec, prices, now);
  if (spec.familyId === VOLATILITY_COMPRESSION_FAMILY) return evaluateVolatilityCompression(spec, prices, now);
  throw new Error(`unsupported PAPER candidate strategy family: ${spec.familyId}`);
}
