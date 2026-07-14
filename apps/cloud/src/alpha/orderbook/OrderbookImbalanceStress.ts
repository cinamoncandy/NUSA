import { createHash } from "node:crypto";

export type OrderbookImbalanceStressKind =
  | "BASELINE"
  | "FEE"
  | "SLIPPAGE"
  | "SPREAD"
  | "LATENCY"
  | "LIQUIDITY"
  | "MISSING_SNAPSHOT"
  | "VOLATILITY"
  | "CAPACITY";

export interface OrderbookImbalanceStressScenario {
  readonly scenarioId: string;
  readonly kind: OrderbookImbalanceStressKind;
  readonly severity: number;
  readonly feeMultiplier: number;
  readonly slippageMultiplier: number;
  readonly spreadMultiplier: number;
  readonly latencySnapshots: number;
  readonly liquidityMultiplier: number;
  readonly missingSnapshotRatio: number;
  readonly volatilityMultiplier: number;
  readonly capacityMultiplier: number;
}

export interface OrderbookImbalanceStressObservation {
  readonly scenarioId: string;
  readonly totalReturn: number;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly tradeCount: number;
  readonly fillRatio: number;
}

export interface OrderbookImbalanceStressPolicy {
  readonly engineVersion: number;
  readonly minimumPositiveScenarioRatio: number;
  readonly minimumMedianSharpe: number;
  readonly maximumWorstDrawdown: number;
  readonly minimumMedianFillRatio: number;
  readonly maximumFragilityScore: number;
}

export interface OrderbookImbalanceStressScenarioResult {
  readonly scenarioId: string;
  readonly kind: OrderbookImbalanceStressKind;
  readonly severity: number;
  readonly totalReturn: number;
  readonly returnDegradation: number;
  readonly sharpe: number;
  readonly sharpeDegradation: number;
  readonly maxDrawdown: number;
  readonly tradeCount: number;
  readonly fillRatio: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

export interface OrderbookImbalanceStressSummary {
  readonly engineVersion: number;
  readonly generatedAt: string;
  readonly baselineScenarioId: string;
  readonly scenarioCount: number;
  readonly positiveScenarioRatio: number;
  readonly medianReturn: number;
  readonly worstReturn: number;
  readonly medianSharpe: number;
  readonly worstSharpe: number;
  readonly worstDrawdown: number;
  readonly medianFillRatio: number;
  readonly robustnessScore: number;
  readonly fragilityScore: number;
  readonly breakEvenFeeMultiplier: number | null;
  readonly breakEvenSlippageMultiplier: number | null;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly scenarios: readonly OrderbookImbalanceStressScenarioResult[];
  readonly resultHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
};
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const validatePolicy = (policy: OrderbookImbalanceStressPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  for (const [label, value] of Object.entries(policy)) if (typeof value === "number") finite(value, label);
  if (policy.minimumPositiveScenarioRatio < 0 || policy.minimumPositiveScenarioRatio > 1) throw new Error("minimumPositiveScenarioRatio must be between 0 and 1");
  if (policy.maximumWorstDrawdown < 0 || policy.maximumWorstDrawdown > 1) throw new Error("maximumWorstDrawdown must be between 0 and 1");
  if (policy.minimumMedianFillRatio < 0 || policy.minimumMedianFillRatio > 1) throw new Error("minimumMedianFillRatio must be between 0 and 1");
  if (policy.maximumFragilityScore < 0 || policy.maximumFragilityScore > 1) throw new Error("maximumFragilityScore must be between 0 and 1");
};

const validateScenario = (scenario: OrderbookImbalanceStressScenario): void => {
  if (!scenario.scenarioId.trim()) throw new Error("scenarioId is required");
  for (const [label, value] of Object.entries(scenario)) {
    if (typeof value === "number") finite(value, `${scenario.scenarioId}.${label}`);
  }
  if (scenario.severity < 0 || scenario.severity > 1) throw new Error("severity must be between 0 and 1");
  if (scenario.feeMultiplier < 0 || scenario.slippageMultiplier < 0 || scenario.spreadMultiplier <= 0) throw new Error("cost multipliers are invalid");
  if (!Number.isInteger(scenario.latencySnapshots) || scenario.latencySnapshots < 0) throw new Error("latencySnapshots must be a non-negative integer");
  if (scenario.liquidityMultiplier < 0 || scenario.liquidityMultiplier > 1) throw new Error("liquidityMultiplier must be between 0 and 1");
  if (scenario.missingSnapshotRatio < 0 || scenario.missingSnapshotRatio > 1) throw new Error("missingSnapshotRatio must be between 0 and 1");
  if (scenario.volatilityMultiplier <= 0 || scenario.capacityMultiplier <= 0) throw new Error("volatility and capacity multipliers must be positive");
};

const validateObservation = (observation: OrderbookImbalanceStressObservation): void => {
  if (!observation.scenarioId.trim()) throw new Error("observation scenarioId is required");
  finite(observation.totalReturn, "totalReturn");
  finite(observation.sharpe, "sharpe");
  finite(observation.maxDrawdown, "maxDrawdown");
  finite(observation.fillRatio, "fillRatio");
  if (observation.maxDrawdown < 0 || observation.maxDrawdown > 1) throw new Error("maxDrawdown must be between 0 and 1");
  if (!Number.isInteger(observation.tradeCount) || observation.tradeCount < 0) throw new Error("tradeCount must be non-negative");
  if (observation.fillRatio < 0 || observation.fillRatio > 1) throw new Error("fillRatio must be between 0 and 1");
};

const breakEvenMultiplier = (
  scenarios: readonly OrderbookImbalanceStressScenario[],
  observations: ReadonlyMap<string, OrderbookImbalanceStressObservation>,
  kind: "FEE" | "SLIPPAGE"
): number | null => {
  const candidates = scenarios
    .filter((scenario) => scenario.kind === kind)
    .map((scenario) => ({
      multiplier: kind === "FEE" ? scenario.feeMultiplier : scenario.slippageMultiplier,
      totalReturn: observations.get(scenario.scenarioId)?.totalReturn ?? Number.NaN
    }))
    .filter((item) => Number.isFinite(item.totalReturn))
    .sort((left, right) => left.multiplier - right.multiplier);
  const firstNonPositive = candidates.find((item) => item.totalReturn <= 0);
  return firstNonPositive ? round(firstNonPositive.multiplier) : null;
};

export const runOrderbookImbalanceStress = (
  scenarios: readonly OrderbookImbalanceStressScenario[],
  observations: readonly OrderbookImbalanceStressObservation[],
  generatedAt: string,
  policy: OrderbookImbalanceStressPolicy
): OrderbookImbalanceStressSummary => {
  validatePolicy(policy);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generatedAt must be a valid ISO timestamp");
  if (scenarios.length < 2) throw new Error("at least two scenarios are required");
  if (observations.length !== scenarios.length) throw new Error("every scenario requires one observation");

  const scenarioIds = new Set<string>();
  const scenarioById = new Map<string, OrderbookImbalanceStressScenario>();
  for (const scenario of scenarios) {
    validateScenario(scenario);
    if (scenarioIds.has(scenario.scenarioId)) throw new Error(`duplicate scenario ${scenario.scenarioId}`);
    scenarioIds.add(scenario.scenarioId);
    scenarioById.set(scenario.scenarioId, scenario);
  }
  const baselines = scenarios.filter((scenario) => scenario.kind === "BASELINE");
  if (baselines.length !== 1) throw new Error("exactly one BASELINE scenario is required");

  const observationIds = new Set<string>();
  const observationById = new Map<string, OrderbookImbalanceStressObservation>();
  for (const observation of observations) {
    validateObservation(observation);
    if (!scenarioById.has(observation.scenarioId)) throw new Error(`observation references unknown scenario ${observation.scenarioId}`);
    if (observationIds.has(observation.scenarioId)) throw new Error(`duplicate observation ${observation.scenarioId}`);
    observationIds.add(observation.scenarioId);
    observationById.set(observation.scenarioId, observation);
  }

  const baseline = baselines[0];
  if (!baseline) throw new Error("baseline missing");
  const baselineObservation = observationById.get(baseline.scenarioId);
  if (!baselineObservation) throw new Error("baseline observation missing");

  const results: OrderbookImbalanceStressScenarioResult[] = scenarios.map((scenario) => {
    const observation = observationById.get(scenario.scenarioId);
    if (!observation) throw new Error(`observation missing for ${scenario.scenarioId}`);
    const reasons: string[] = [];
    if (observation.totalReturn <= 0) reasons.push("NON_POSITIVE_RETURN");
    if (observation.maxDrawdown > policy.maximumWorstDrawdown) reasons.push("DRAWDOWN_LIMIT_EXCEEDED");
    if (observation.fillRatio < policy.minimumMedianFillRatio) reasons.push("FILL_RATIO_LOW");
    if (observation.tradeCount === 0) reasons.push("NO_TRADES");
    if (reasons.length === 0) reasons.push("SCENARIO_PASSED");
    return Object.freeze({
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      severity: round(scenario.severity),
      totalReturn: round(observation.totalReturn),
      returnDegradation: round(baselineObservation.totalReturn - observation.totalReturn),
      sharpe: round(observation.sharpe),
      sharpeDegradation: round(baselineObservation.sharpe - observation.sharpe),
      maxDrawdown: round(observation.maxDrawdown),
      tradeCount: observation.tradeCount,
      fillRatio: round(observation.fillRatio),
      passed: reasons.length === 1 && reasons[0] === "SCENARIO_PASSED",
      reasons: Object.freeze(reasons)
    });
  });

  const positiveScenarioRatio = results.filter((item) => item.totalReturn > 0).length / results.length;
  const medianReturn = median(results.map((item) => item.totalReturn));
  const medianSharpe = median(results.map((item) => item.sharpe));
  const medianFillRatio = median(results.map((item) => item.fillRatio));
  const worstReturn = Math.min(...results.map((item) => item.totalReturn));
  const worstSharpe = Math.min(...results.map((item) => item.sharpe));
  const worstDrawdown = Math.max(...results.map((item) => item.maxDrawdown));
  const normalizedReturnDamage = baselineObservation.totalReturn === 0
    ? (medianReturn < 0 ? 1 : 0)
    : clamp01((baselineObservation.totalReturn - medianReturn) / Math.max(Math.abs(baselineObservation.totalReturn), 1e-12));
  const fragilityScore = clamp01(
    normalizedReturnDamage * 0.35
    + clamp01(worstDrawdown / Math.max(policy.maximumWorstDrawdown, 1e-12)) * 0.25
    + (1 - positiveScenarioRatio) * 0.25
    + (1 - medianFillRatio) * 0.15
  );
  const robustnessScore = 1 - fragilityScore;

  const reasons: string[] = [];
  if (positiveScenarioRatio < policy.minimumPositiveScenarioRatio) reasons.push("POSITIVE_SCENARIO_RATIO_LOW");
  if (medianSharpe < policy.minimumMedianSharpe) reasons.push("MEDIAN_SHARPE_LOW");
  if (worstDrawdown > policy.maximumWorstDrawdown) reasons.push("WORST_DRAWDOWN_HIGH");
  if (medianFillRatio < policy.minimumMedianFillRatio) reasons.push("MEDIAN_FILL_RATIO_LOW");
  if (fragilityScore > policy.maximumFragilityScore) reasons.push("FRAGILITY_SCORE_HIGH");
  if (reasons.length === 0) reasons.push("STRESS_POLICY_PASSED");

  const payload = {
    engineVersion: policy.engineVersion,
    generatedAt,
    baselineScenarioId: baseline.scenarioId,
    scenarioCount: results.length,
    positiveScenarioRatio: round(positiveScenarioRatio),
    medianReturn: round(medianReturn),
    worstReturn: round(worstReturn),
    medianSharpe: round(medianSharpe),
    worstSharpe: round(worstSharpe),
    worstDrawdown: round(worstDrawdown),
    medianFillRatio: round(medianFillRatio),
    robustnessScore: round(robustnessScore),
    fragilityScore: round(fragilityScore),
    breakEvenFeeMultiplier: breakEvenMultiplier(scenarios, observationById, "FEE"),
    breakEvenSlippageMultiplier: breakEvenMultiplier(scenarios, observationById, "SLIPPAGE"),
    passed: reasons.length === 1 && reasons[0] === "STRESS_POLICY_PASSED",
    reasons: Object.freeze(reasons),
    scenarios: Object.freeze(results)
  };
  const resultHash = hash(payload);
  if (!SHA256.test(resultHash)) throw new Error("result hash invariant violated");
  return Object.freeze({ ...payload, resultHash });
};
