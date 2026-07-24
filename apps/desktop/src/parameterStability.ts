import { createHash } from "node:crypto";
import type { BacktestPoint } from "./backtestEngine";
import { runWalkForward, type WalkForwardCandidate, type WalkForwardConfig, type WalkForwardResult } from "./walkForwardEngine";

export type ParameterStabilityStatus = "ROBUST" | "ACCEPTABLE" | "FRAGILE" | "INSUFFICIENT_EVIDENCE";

export interface ParameterStabilityConfig {
  readonly minimumNeighbors?: number;
  readonly maximumReturnDrop?: number;
  readonly maximumDrawdownIncrease?: number;
  readonly minimumPositiveNeighborRatio?: number;
  readonly minimumOosTradeCount?: number;
}

export interface ParameterStabilityInput {
  readonly base: WalkForwardCandidate;
  readonly neighbors: readonly WalkForwardCandidate[];
}

export interface ParameterStabilityRun {
  readonly candidateId: string;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
  readonly result: WalkForwardResult;
  readonly markedTotalReturn: number;
  readonly markedMaximumDrawdown: number;
  readonly closedTradeExpectancy?: number;
  readonly closedTradeProfitFactor?: number;
  readonly totalOosClosedTrades: number;
  readonly benchmarkOutperformanceRatio: number;
}

export interface ParameterStabilityResult {
  readonly identitySha256: string;
  readonly status: ParameterStabilityStatus;
  readonly base: ParameterStabilityRun;
  readonly neighbors: readonly ParameterStabilityRun[];
  readonly neighborAverageReturn: number;
  readonly worstNeighborReturn: number;
  readonly returnDispersion: number;
  readonly drawdownDispersion: number;
  readonly positiveNeighborRatio: number;
  readonly benchmarkOutperformanceNeighborRatio: number;
  readonly warnings: readonly string[];
}

const defaults: Required<ParameterStabilityConfig> = Object.freeze({
  minimumNeighbors: 2,
  maximumReturnDrop: 0.5,
  maximumDrawdownIncrease: 0.5,
  minimumPositiveNeighborRatio: 0.5,
  minimumOosTradeCount: 3
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonicalParameters(parameters: WalkForwardCandidate["parameters"]): string {
  const entries = Object.entries(parameters ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [, value] of entries) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("parameter values must be finite");
  }
  return JSON.stringify(Object.fromEntries(entries));
}

function validate(input: ParameterStabilityInput, config: Required<ParameterStabilityConfig>): readonly WalkForwardCandidate[] {
  if (!input.base.id || typeof input.base.strategyFactory !== "function") throw new Error("base candidate is invalid");
  if (!Number.isInteger(config.minimumNeighbors) || config.minimumNeighbors < 1) throw new Error("minimumNeighbors must be a positive integer");
  for (const value of [config.maximumReturnDrop, config.maximumDrawdownIncrease, config.minimumPositiveNeighborRatio]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("stability ratio thresholds must be between 0 and 1");
  }
  if (!Number.isInteger(config.minimumOosTradeCount) || config.minimumOosTradeCount < 0) throw new Error("minimumOosTradeCount must be a non-negative integer");
  if (input.neighbors.length < config.minimumNeighbors) throw new Error("insufficient parameter neighbors");

  const ids = new Set<string>([input.base.id]);
  const baseParameters = canonicalParameters(input.base.parameters);
  for (const neighbor of input.neighbors) {
    if (!neighbor.id || typeof neighbor.strategyFactory !== "function") throw new Error("neighbor candidate is invalid");
    if (ids.has(neighbor.id)) throw new Error("parameter candidate ids must be unique");
    if (canonicalParameters(neighbor.parameters) === baseParameters) throw new Error("neighbor parameters must differ from base parameters");
    ids.add(neighbor.id);
  }
  return Object.freeze([...input.neighbors].sort((left, right) => left.id.localeCompare(right.id)));
}

function summarize(candidate: WalkForwardCandidate, points: readonly BacktestPoint[], config: WalkForwardConfig): ParameterStabilityRun {
  const result = runWalkForward(points, [candidate], config);
  const metrics = result.combinedOutOfSampleMetrics;
  return freeze({
    candidateId: candidate.id,
    parameters: candidate.parameters == null ? undefined : freeze({ ...candidate.parameters }),
    result,
    markedTotalReturn: metrics.markedTotalReturn,
    markedMaximumDrawdown: metrics.markedMaximumDrawdown,
    closedTradeExpectancy: metrics.closedTradeExpectancy,
    closedTradeProfitFactor: metrics.closedTradeProfitFactor,
    totalOosClosedTrades: metrics.totalOosClosedTrades,
    benchmarkOutperformanceRatio: metrics.benchmarkOutperformanceWindowRatio
  });
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function identity(base: WalkForwardCandidate, neighbors: readonly WalkForwardCandidate[], walkForwardConfig: WalkForwardConfig): string {
  const payload = {
    engineVersion: "parameter-stability-v1",
    base: { id: base.id, parameters: JSON.parse(canonicalParameters(base.parameters)) },
    neighbors: neighbors.map((neighbor) => ({ id: neighbor.id, parameters: JSON.parse(canonicalParameters(neighbor.parameters)) })),
    walkForwardConfig
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function runParameterStability(
  points: readonly BacktestPoint[],
  input: ParameterStabilityInput,
  walkForwardConfig: WalkForwardConfig,
  config: ParameterStabilityConfig = {}
): ParameterStabilityResult {
  const normalized = freeze({ ...defaults, ...config });
  const neighbors = validate(input, normalized);
  const base = summarize(input.base, points, walkForwardConfig);
  const runs = Object.freeze(neighbors.map((neighbor) => summarize(neighbor, points, walkForwardConfig)));
  const returns = runs.map((run) => run.markedTotalReturn);
  const drawdowns = runs.map((run) => run.markedMaximumDrawdown);
  const neighborAverageReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const worstNeighborReturn = Math.min(...returns);
  const positiveNeighborRatio = returns.filter((value) => value > 0).length / returns.length;
  const benchmarkOutperformanceNeighborRatio = runs.filter((run) => run.benchmarkOutperformanceRatio > 0.5).length / runs.length;
  const warnings: string[] = [];

  if (runs.some((run) => run.totalOosClosedTrades < normalized.minimumOosTradeCount)) warnings.push("INSUFFICIENT_OOS_TRADES");
  if (positiveNeighborRatio < normalized.minimumPositiveNeighborRatio) warnings.push("RETURN_DEPENDS_ON_SINGLE_POINT");
  if (base.markedTotalReturn > 0 && neighborAverageReturn < base.markedTotalReturn * (1 - normalized.maximumReturnDrop)) warnings.push("PARAMETER_CLIFF");
  if (base.markedMaximumDrawdown > 0 && Math.max(...drawdowns) > base.markedMaximumDrawdown * (1 + normalized.maximumDrawdownIncrease)) warnings.push("DRAWDOWN_UNSTABLE");
  const expectancies = runs.map((run) => run.closedTradeExpectancy).filter((value): value is number => value != null);
  if (base.closedTradeExpectancy != null && expectancies.some((value) => Math.sign(value) !== Math.sign(base.closedTradeExpectancy!))) warnings.push("EXPECTANCY_UNSTABLE");
  if (benchmarkOutperformanceNeighborRatio < normalized.minimumPositiveNeighborRatio) warnings.push("BENCHMARK_EDGE_UNSTABLE");

  let status: ParameterStabilityStatus;
  if (warnings.includes("INSUFFICIENT_OOS_TRADES")) status = "INSUFFICIENT_EVIDENCE";
  else if (warnings.some((warning) => ["PARAMETER_CLIFF", "RETURN_DEPENDS_ON_SINGLE_POINT", "DRAWDOWN_UNSTABLE", "EXPECTANCY_UNSTABLE"].includes(warning))) status = "FRAGILE";
  else if (positiveNeighborRatio === 1 && benchmarkOutperformanceNeighborRatio === 1) status = "ROBUST";
  else status = "ACCEPTABLE";

  return freeze({
    identitySha256: identity(input.base, neighbors, walkForwardConfig),
    status,
    base,
    neighbors: runs,
    neighborAverageReturn,
    worstNeighborReturn,
    returnDispersion: standardDeviation(returns),
    drawdownDispersion: standardDeviation(drawdowns),
    positiveNeighborRatio,
    benchmarkOutperformanceNeighborRatio,
    warnings: Object.freeze(warnings)
  });
}
