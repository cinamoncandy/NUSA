import { createHash } from "node:crypto";
import {
  runFundingPersistenceBacktest,
  type FundingPersistenceBacktestCandle,
  type FundingPersistenceBacktestPolicy,
  type FundingPersistenceBacktestResult
} from "./FundingPersistenceBacktest";
import type { FundingPersistenceStrategyDecision } from "./FundingPersistenceStrategy";

export type FundingPersistenceStressKind =
  | "BASELINE"
  | "COST"
  | "LATENCY"
  | "MISSING_CANDLE"
  | "GAP"
  | "VOLATILITY"
  | "CAPACITY";

export interface FundingPersistenceStressScenario {
  readonly scenarioId: string;
  readonly kind: FundingPersistenceStressKind;
  readonly feeMultiplier: number;
  readonly slippageMultiplier: number;
  readonly borrowMultiplier: number;
  readonly latencyCandles: number;
  readonly missingEveryNthCandle: number | null;
  readonly gapIndex: number | null;
  readonly gapRate: number;
  readonly volatilityMultiplier: number;
  readonly allocationMultiplier: number;
}

export interface FundingPersistenceStressPolicy {
  readonly engineVersion: number;
  readonly minimumRobustnessScore: number;
  readonly maximumAcceptableDrawdown: number;
  readonly minimumPositiveScenarioRatio: number;
  readonly maximumScenarioCount: number;
}

export interface FundingPersistenceStressObservation {
  readonly scenarioId: string;
  readonly kind: FundingPersistenceStressKind;
  readonly totalReturn: number;
  readonly sharpe: number;
  readonly maximumDrawdown: number;
  readonly profitFactor: number;
  readonly closedTrades: number;
  readonly finalEquity: number;
  readonly positive: boolean;
  readonly acceptableDrawdown: boolean;
  readonly degradationFromBaseline: number;
  readonly warnings: readonly string[];
}

export interface FundingPersistenceStressSummary {
  readonly engineVersion: number;
  readonly market: string;
  readonly generatedAt: string;
  readonly baselineScenarioId: string;
  readonly observations: readonly FundingPersistenceStressObservation[];
  readonly robustnessScore: number;
  readonly fragilityScore: number;
  readonly positiveScenarioRatio: number;
  readonly acceptableDrawdownRatio: number;
  readonly worstTotalReturn: number;
  readonly medianTotalReturn: number;
  readonly worstSharpe: number;
  readonly medianSharpe: number;
  readonly worstDrawdown: number;
  readonly breakEvenFeeMultiplier: number | null;
  readonly breakEvenSlippageMultiplier: number | null;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly contentHash: string;
}

const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const SHA256 = /^[a-f0-9]{64}$/;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};

const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const validateStressPolicy = (policy: FundingPersistenceStressPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) {
    throw new Error("engineVersion must be a positive integer");
  }
  for (const [label, value] of [
    ["minimumRobustnessScore", policy.minimumRobustnessScore],
    ["maximumAcceptableDrawdown", policy.maximumAcceptableDrawdown],
    ["minimumPositiveScenarioRatio", policy.minimumPositiveScenarioRatio]
  ] as const) {
    requireFinite(value, label);
    if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  }
  if (!Number.isInteger(policy.maximumScenarioCount) || policy.maximumScenarioCount < 1) {
    throw new Error("maximumScenarioCount must be a positive integer");
  }
};

const validateScenario = (scenario: FundingPersistenceStressScenario): void => {
  if (!scenario.scenarioId.trim()) throw new Error("scenarioId is required");
  const allowed = new Set<FundingPersistenceStressKind>([
    "BASELINE",
    "COST",
    "LATENCY",
    "MISSING_CANDLE",
    "GAP",
    "VOLATILITY",
    "CAPACITY"
  ]);
  if (!allowed.has(scenario.kind)) throw new Error(`invalid stress kind ${scenario.kind}`);
  for (const [label, value] of [
    ["feeMultiplier", scenario.feeMultiplier],
    ["slippageMultiplier", scenario.slippageMultiplier],
    ["borrowMultiplier", scenario.borrowMultiplier],
    ["gapRate", scenario.gapRate],
    ["volatilityMultiplier", scenario.volatilityMultiplier],
    ["allocationMultiplier", scenario.allocationMultiplier]
  ] as const) {
    requireFinite(value, `${scenario.scenarioId}.${label}`);
  }
  if (scenario.feeMultiplier < 0 || scenario.slippageMultiplier < 0 || scenario.borrowMultiplier < 0) {
    throw new Error("cost multipliers must be non-negative");
  }
  if (!Number.isInteger(scenario.latencyCandles) || scenario.latencyCandles < 0) {
    throw new Error("latencyCandles must be a non-negative integer");
  }
  if (scenario.missingEveryNthCandle !== null && (!Number.isInteger(scenario.missingEveryNthCandle) || scenario.missingEveryNthCandle < 2)) {
    throw new Error("missingEveryNthCandle must be null or an integer of at least 2");
  }
  if (scenario.gapIndex !== null && (!Number.isInteger(scenario.gapIndex) || scenario.gapIndex < 1)) {
    throw new Error("gapIndex must be null or a positive integer");
  }
  if (scenario.gapRate <= -0.95) throw new Error("gapRate is too negative");
  if (scenario.volatilityMultiplier <= 0) throw new Error("volatilityMultiplier must be positive");
  if (scenario.allocationMultiplier <= 0) throw new Error("allocationMultiplier must be positive");
};

const freezeObservation = (observation: FundingPersistenceStressObservation): FundingPersistenceStressObservation => {
  Object.freeze(observation.warnings);
  return Object.freeze(observation);
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const shiftDecision = (
  decision: FundingPersistenceStrategyDecision,
  candles: readonly FundingPersistenceBacktestCandle[],
  latencyCandles: number
): FundingPersistenceStrategyDecision => {
  if (latencyCandles === 0) return decision;
  const decisionTime = parseTime(decision.generatedAt, `${decision.decisionId}.generatedAt`);
  const futureOpens = candles
    .map((candle) => ({ timestamp: parseTime(candle.openTime, `${candle.candleId}.openTime`), openTime: candle.openTime }))
    .filter((item) => item.timestamp > decisionTime);
  const delayed = futureOpens[latencyCandles - 1];
  if (!delayed) {
    return Object.freeze({ ...decision, generatedAt: new Date(8640000000000000).toISOString() });
  }
  return Object.freeze({ ...decision, generatedAt: delayed.openTime });
};

const applyMissingCandles = (
  candles: readonly FundingPersistenceBacktestCandle[],
  every: number | null
): readonly FundingPersistenceBacktestCandle[] => {
  if (every === null) return candles;
  const filtered = candles.filter((_, index) => index === 0 || index === candles.length - 1 || (index + 1) % every !== 0);
  if (filtered.length < 2) throw new Error("missing-candle scenario leaves fewer than two candles");
  return Object.freeze(filtered);
};

const applyGap = (
  candles: readonly FundingPersistenceBacktestCandle[],
  gapIndex: number | null,
  gapRate: number
): readonly FundingPersistenceBacktestCandle[] => {
  if (gapIndex === null || gapRate === 0) return candles;
  if (gapIndex >= candles.length) throw new Error("gapIndex exceeds candle range");
  return Object.freeze(candles.map((candle, index) => {
    if (index < gapIndex) return candle;
    const multiplier = 1 + gapRate;
    return Object.freeze({
      ...candle,
      open: round(candle.open * multiplier),
      high: round(candle.high * multiplier),
      low: round(candle.low * multiplier),
      close: round(candle.close * multiplier)
    });
  }));
};

const applyVolatility = (
  candles: readonly FundingPersistenceBacktestCandle[],
  multiplier: number
): readonly FundingPersistenceBacktestCandle[] => {
  if (multiplier === 1) return candles;
  return Object.freeze(candles.map((candle) => {
    const open = candle.open;
    const close = open + (candle.close - open) * multiplier;
    const highDistance = Math.max(0, candle.high - Math.max(candle.open, candle.close));
    const lowDistance = Math.max(0, Math.min(candle.open, candle.close) - candle.low);
    const high = Math.max(open, close) + highDistance * multiplier;
    const low = Math.max(1e-9, Math.min(open, close) - lowDistance * multiplier);
    return Object.freeze({
      ...candle,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close)
    });
  }));
};

const scenarioPolicy = (
  baseline: FundingPersistenceBacktestPolicy,
  scenario: FundingPersistenceStressScenario
): FundingPersistenceBacktestPolicy => Object.freeze({
  ...baseline,
  takerFeeRate: baseline.takerFeeRate * scenario.feeMultiplier,
  slippageRate: baseline.slippageRate * scenario.slippageMultiplier,
  borrowRatePerCandle: baseline.borrowRatePerCandle * scenario.borrowMultiplier,
  allocationFraction: Math.min(1, baseline.allocationFraction * scenario.allocationMultiplier)
});

const runScenario = (
  candles: readonly FundingPersistenceBacktestCandle[],
  decisions: readonly FundingPersistenceStrategyDecision[],
  baselinePolicy: FundingPersistenceBacktestPolicy,
  scenario: FundingPersistenceStressScenario
): FundingPersistenceBacktestResult => {
  const missing = applyMissingCandles(candles, scenario.missingEveryNthCandle);
  const gapped = applyGap(missing, scenario.gapIndex, scenario.gapRate);
  const stressedCandles = applyVolatility(gapped, scenario.volatilityMultiplier);
  const delayedDecisions = Object.freeze(decisions.map((decision) => shiftDecision(decision, stressedCandles, scenario.latencyCandles)));
  return runFundingPersistenceBacktest(stressedCandles, delayedDecisions, scenarioPolicy(baselinePolicy, scenario));
};

const findBreakEvenMultiplier = (
  observations: readonly FundingPersistenceStressObservation[],
  scenarios: readonly FundingPersistenceStressScenario[],
  field: "feeMultiplier" | "slippageMultiplier"
): number | null => {
  const candidates = observations
    .map((observation) => {
      const scenario = scenarios.find((item) => item.scenarioId === observation.scenarioId);
      return scenario ? { observation, multiplier: scenario[field] } : null;
    })
    .filter((item): item is { observation: FundingPersistenceStressObservation; multiplier: number } => item !== null)
    .filter((item) => item.multiplier >= 1)
    .sort((left, right) => left.multiplier - right.multiplier);
  const firstNonPositive = candidates.find((item) => item.observation.totalReturn <= 0);
  return firstNonPositive ? round(firstNonPositive.multiplier) : null;
};

export const createDefaultFundingPersistenceStressScenarios = (): readonly FundingPersistenceStressScenario[] => Object.freeze([
  Object.freeze({ scenarioId: "BASE", kind: "BASELINE", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "FEE_2X", kind: "COST", feeMultiplier: 2, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "FEE_3X", kind: "COST", feeMultiplier: 3, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "SLIPPAGE_2X", kind: "COST", feeMultiplier: 1, slippageMultiplier: 2, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "SLIPPAGE_4X", kind: "COST", feeMultiplier: 1, slippageMultiplier: 4, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "LATENCY_1", kind: "LATENCY", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 1, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "LATENCY_2", kind: "LATENCY", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 2, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "MISSING_5", kind: "MISSING_CANDLE", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: 5, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "GAP_DOWN_10", kind: "GAP", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: 2, gapRate: -0.1, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "GAP_UP_10", kind: "GAP", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: 2, gapRate: 0.1, volatilityMultiplier: 1, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "VOL_2X", kind: "VOLATILITY", feeMultiplier: 1, slippageMultiplier: 1, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 2, allocationMultiplier: 1 }),
  Object.freeze({ scenarioId: "CAPACITY_50", kind: "CAPACITY", feeMultiplier: 1, slippageMultiplier: 1.5, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 0.5 }),
  Object.freeze({ scenarioId: "CAPACITY_150", kind: "CAPACITY", feeMultiplier: 1.25, slippageMultiplier: 2, borrowMultiplier: 1, latencyCandles: 0, missingEveryNthCandle: null, gapIndex: null, gapRate: 0, volatilityMultiplier: 1, allocationMultiplier: 1.5 })
]);

export const runFundingPersistenceStress = (
  candles: readonly FundingPersistenceBacktestCandle[],
  decisions: readonly FundingPersistenceStrategyDecision[],
  baselinePolicy: FundingPersistenceBacktestPolicy,
  scenarios: readonly FundingPersistenceStressScenario[],
  generatedAt: string,
  policy: FundingPersistenceStressPolicy
): FundingPersistenceStressSummary => {
  validateStressPolicy(policy);
  parseTime(generatedAt, "generatedAt");
  if (scenarios.length < 2) throw new Error("at least two stress scenarios are required");
  if (scenarios.length > policy.maximumScenarioCount) throw new Error("scenario count exceeds maximumScenarioCount");
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    validateScenario(scenario);
    if (ids.has(scenario.scenarioId)) throw new Error(`duplicate scenario ${scenario.scenarioId}`);
    ids.add(scenario.scenarioId);
  }
  const baselines = scenarios.filter((scenario) => scenario.kind === "BASELINE");
  if (baselines.length !== 1) throw new Error("exactly one BASELINE scenario is required");

  const baselineScenario = baselines[0];
  if (!baselineScenario) throw new Error("baseline invariant violated");
  const baselineResult = runScenario(candles, decisions, baselinePolicy, baselineScenario);
  const baselineReturn = baselineResult.metrics.totalReturn;

  const observations = scenarios.map((scenario) => {
    const result = scenario.scenarioId === baselineScenario.scenarioId
      ? baselineResult
      : runScenario(candles, decisions, baselinePolicy, scenario);
    const warnings: string[] = [];
    if (result.metrics.closedTrades === 0) warnings.push("NO_CLOSED_TRADES");
    if (result.metrics.maximumDrawdown > policy.maximumAcceptableDrawdown) warnings.push("DRAWDOWN_LIMIT_EXCEEDED");
    if (result.metrics.totalReturn <= 0) warnings.push("NON_POSITIVE_RETURN");
    const denominator = Math.max(Math.abs(baselineReturn), 1e-9);
    const degradation = baselineReturn - result.metrics.totalReturn;
    return freezeObservation({
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      totalReturn: round(result.metrics.totalReturn),
      sharpe: round(result.metrics.sharpe),
      maximumDrawdown: round(result.metrics.maximumDrawdown),
      profitFactor: round(result.metrics.profitFactor),
      closedTrades: result.metrics.closedTrades,
      finalEquity: round(result.finalEquity),
      positive: result.metrics.totalReturn > 0,
      acceptableDrawdown: result.metrics.maximumDrawdown <= policy.maximumAcceptableDrawdown,
      degradationFromBaseline: round(degradation / denominator),
      warnings: Object.freeze(warnings)
    });
  });

  const positiveScenarioRatio = observations.filter((item) => item.positive).length / observations.length;
  const acceptableDrawdownRatio = observations.filter((item) => item.acceptableDrawdown).length / observations.length;
  const normalizedReturns = observations.map((item) => {
    if (baselineReturn === 0) return item.totalReturn > 0 ? 1 : item.totalReturn === 0 ? 0.5 : 0;
    return clamp01((item.totalReturn / Math.abs(baselineReturn) + 1) / 2);
  });
  const robustnessScore = clamp01(
    0.4 * positiveScenarioRatio
    + 0.25 * acceptableDrawdownRatio
    + 0.2 * median(normalizedReturns)
    + 0.15 * clamp01(observations.filter((item) => item.closedTrades > 0).length / observations.length)
  );
  const fragilityScore = 1 - robustnessScore;
  const reasons: string[] = [];
  if (robustnessScore < policy.minimumRobustnessScore) reasons.push("ROBUSTNESS_SCORE_LOW");
  if (positiveScenarioRatio < policy.minimumPositiveScenarioRatio) reasons.push("POSITIVE_SCENARIO_RATIO_LOW");
  if (acceptableDrawdownRatio < 1) reasons.push("ONE_OR_MORE_DRAWDOWN_BREACHES");
  if (baselineReturn <= 0) reasons.push("BASELINE_NOT_POSITIVE");
  if (reasons.length === 0) reasons.push("STRESS_POLICY_PASSED");

  const payload = {
    engineVersion: policy.engineVersion,
    market: baselineResult.market,
    generatedAt,
    baselineScenarioId: baselineScenario.scenarioId,
    observations: Object.freeze(observations),
    robustnessScore: round(robustnessScore),
    fragilityScore: round(fragilityScore),
    positiveScenarioRatio: round(positiveScenarioRatio),
    acceptableDrawdownRatio: round(acceptableDrawdownRatio),
    worstTotalReturn: round(Math.min(...observations.map((item) => item.totalReturn))),
    medianTotalReturn: round(median(observations.map((item) => item.totalReturn))),
    worstSharpe: round(Math.min(...observations.map((item) => item.sharpe)),
    medianSharpe: round(median(observations.map((item) => item.sharpe))),
    worstDrawdown: round(Math.max(...observations.map((item) => item.maximumDrawdown))),
    breakEvenFeeMultiplier: findBreakEvenMultiplier(observations, scenarios, "feeMultiplier"),
    breakEvenSlippageMultiplier: findBreakEvenMultiplier(observations, scenarios, "slippageMultiplier"),
    passed: reasons.length === 1 && reasons[0] === "STRESS_POLICY_PASSED",
    reasons: Object.freeze(reasons)
  };
  const contentHash = hash(payload);
  if (!SHA256.test(contentHash)) throw new Error("content hash invariant violated");
  return Object.freeze({ ...payload, contentHash });
};
