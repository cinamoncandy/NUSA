import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperCandidateStrategyDecision } from "./cioDecisionEngine";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

const SMA_FAMILY = "sma-crossover";
const RSI_FAMILY = "rsi-mean-reversion";
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
  throw new Error(`unsupported PAPER candidate strategy family: ${spec.familyId}`);
}
