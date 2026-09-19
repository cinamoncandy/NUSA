import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperCandidateStrategyDecision } from "./cioDecisionEngine";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

const SMA_FAMILY = "sma-crossover";
const RSI_FAMILY = "rsi-mean-reversion";
const DONCHIAN_FAMILY = "donchian-breakout";
const BOLLINGER_FAMILY = "bollinger-breakout";

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

function parseBollingerParameters(spec: PaperCandidateStrategySpec): { period: number; multiplier: number } {
  const { period, multiplier } = spec.parameters;
  if (!finitePositiveInteger(period) || period < 2 || period > 500 || typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("PAPER Bollinger candidate parameters are invalid");
  }
  return { period, multiplier };
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

function bollingerPosition(closes: readonly number[], period: number, multiplier: number): { position: -1 | 0 | 1; upper: number; lower: number } {
  const window = closes.slice(-period);
  const mean = window.reduce((total, price) => total + price, 0) / window.length;
  const variance = window.reduce((total, price) => total + (price - mean) ** 2, 0) / window.length;
  const deviation = Math.sqrt(variance);
  const upper = mean + multiplier * deviation;
  const lower = mean - multiplier * deviation;
  const close = window.at(-1)!;
  return { position: close > upper ? 1 : close < lower ? -1 : 0, upper, lower };
}

function evaluateBollinger(spec: PaperCandidateStrategySpec, prices: readonly (readonly [number, number])[], now: number): PaperCandidateStrategyDecision {
  const { period, multiplier } = parseBollingerParameters(spec);
  if (prices.length < period) {
    return Object.freeze({ action: "WAIT", score: 0, confidence: 0, observedAt: prices.at(-1)?.[0] ?? now, reason: `INSUFFICIENT_BOLLINGER_OBSERVATIONS:${prices.length}/${period}` });
  }
  const closes = prices.map(([, price]) => price);
  const current = bollingerPosition(closes, period, multiplier);
  const observedAt = prices.at(-1)![0];
  if (prices.length === period) {
    return Object.freeze({ action: "HOLD", score: 0, confidence: 0, observedAt, reason: `BOLLINGER_BREAKOUT:${period}/${round4(multiplier)}:baseline-established` });
  }
  const prior = bollingerPosition(closes.slice(0, -1), period, multiplier);
  let action: PaperCandidateStrategyDecision["action"] = "HOLD";
  let confidence = 0;
  if (prior.position <= 0 && current.position === 1) {
    action = "BUY";
    confidence = current.upper > 0 ? clamp((closes.at(-1)! - current.upper) / current.upper, 0, 1) : 1;
  } else if (prior.position >= 0 && current.position === -1) {
    action = "SELL";
    confidence = current.lower > 0 ? clamp((current.lower - closes.at(-1)!) / current.lower, 0, 1) : 1;
  }
  confidence = round4(confidence);
  return Object.freeze({ action, score: action === "BUY" ? confidence : action === "SELL" ? -confidence : 0, confidence, observedAt, reason: `BOLLINGER_BREAKOUT:${period}/${round4(multiplier)}:prior=${prior.position}:current=${current.position}` });
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
  if (spec.familyId === BOLLINGER_FAMILY) return evaluateBollinger(spec, prices, now);

  throw new Error(`unsupported PAPER candidate strategy family: ${spec.familyId}`);
}
