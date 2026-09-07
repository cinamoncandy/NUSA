import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperCandidateStrategyDecision } from "./cioDecisionEngine";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

const SUPPORTED_FAMILY = "sma-crossover";
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSmaParameters(spec: PaperCandidateStrategySpec): { shortPeriod: number; longPeriod: number } {
  if (spec.familyId !== SUPPORTED_FAMILY) throw new Error(`unsupported PAPER candidate strategy family: ${spec.familyId}`);
  const parameters = spec.parameters;
  const shortPeriod = parameters.shortPeriod;
  const longPeriod = parameters.longPeriod;
  if (!finitePositiveInteger(shortPeriod) || !finitePositiveInteger(longPeriod) || shortPeriod >= longPeriod || longPeriod > 500) {
    throw new Error("PAPER SMA candidate parameters are invalid");
  }
  return { shortPeriod, longPeriod };
}

/**
 * Evaluates the exact supported candidate semantics over the already accepted public ticker
 * observations. It is deterministic and read-only: no generic CIO score is used as a fallback.
 */
export function evaluatePaperCandidateStrategy(
  spec: PaperCandidateStrategySpec,
  observations: readonly IntelligenceObservation[],
  now: number,
  market?: string,
): PaperCandidateStrategyDecision {
  const { shortPeriod, longPeriod } = parseSmaParameters(spec);
  const points = observations
    .filter((item) => market == null || item.market?.trim().toUpperCase() === market.trim().toUpperCase())
    .filter((item) => item.source === "CHART" && item.price !== undefined && Number.isFinite(item.price) && item.price > 0 && item.observedAt <= now)
    .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id));
  const unique = new Map<number, number>();
  for (const point of points) unique.set(point.observedAt, point.price!);
  const prices = [...unique.entries()].sort(([left], [right]) => left - right);
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
