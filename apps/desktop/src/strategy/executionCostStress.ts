import { createHash } from "node:crypto";
import type { BacktestPoint } from "./backtestEngine";
import { runWalkForward, runWalkForwardFixedSelection, type WalkForwardCandidate, type WalkForwardConfig, type WalkForwardResult } from "./walkForwardEngine";

export type CandidateSelectionMode = "RESELECT_PER_SCENARIO" | "FIX_BASELINE_SELECTION";
export interface ExecutionCostScenario { readonly id: string; readonly feeRate: number; readonly spreadBps: number; readonly slippageBps: number; readonly latencyMs?: number; readonly label?: string; }
export interface ExecutionCostCollapseThresholds { readonly returnDegradationRatio?: number; readonly drawdownExpansionRatio?: number; readonly minimumClosedTrades?: number; }
export interface ExecutionCostStressConfig { readonly scenarios: readonly ExecutionCostScenario[]; readonly baselineScenarioId: string; readonly candidateSelectionMode?: CandidateSelectionMode; readonly minimumScenarioCount?: number; readonly collapseThresholds?: ExecutionCostCollapseThresholds; }
export interface ExecutionCostScenarioResult { readonly scenario: ExecutionCostScenario; readonly selectionMode: CandidateSelectionMode; readonly walkForwardResult: WalkForwardResult; readonly markedTotalReturn: number; readonly markedMaximumDrawdown: number; readonly closedTradeNetProfit: number; readonly closedTradeExpectancy?: number; readonly closedTradeProfitFactor?: number; readonly totalTradingCost: number; readonly benchmarkOutperformance: number; readonly warnings: readonly string[]; }
export interface ExecutionCostDegradation { readonly scenarioId: string; readonly returnDegradation: number; readonly drawdownIncrease: number; readonly expectancyDegradation?: number; readonly profitFactorDegradation?: number; readonly performancePerCostBps?: number; }
export interface BreakEvenEstimate { readonly status: "ESTIMATED" | "NOT_FOUND"; readonly label: "ESTIMATED_NOT_EXACT_GRID_DEPENDENT" | "BREAK_EVEN_NOT_FOUND"; readonly costLoadBps?: number; readonly lowerScenarioId?: string; readonly upperScenarioId?: string; }
export interface ExecutionCostStressIdentity { readonly id: string; readonly sourceExperimentSha: string; readonly datasetSha256: string; readonly stressGridSha256: string; readonly selectionMode: CandidateSelectionMode; readonly engineVersion: string; }
export interface ExecutionCostStressResult { readonly selectionMode: CandidateSelectionMode; readonly baseline: ExecutionCostScenarioResult; readonly scenarios: readonly ExecutionCostScenarioResult[]; readonly degradation: readonly ExecutionCostDegradation[]; readonly breakEvenEstimate: BreakEvenEstimate; readonly robustnessScore: number; readonly identity: ExecutionCostStressIdentity; readonly warnings: readonly string[]; }
export interface StressExperimentIdentityInput { readonly sourceExperimentSha: string; readonly datasetSha256: string; readonly engineVersion?: string; }
export interface ResearchMemoryStressAdapter { appendExperiment(record: { readonly id: string; readonly datasetId: string; readonly contentSha256: string; readonly manifestSchemaVersion: number; readonly market: string; readonly interval: string; readonly startOpenTime: number; readonly endCloseTime: number; readonly walkForwardConfigJson: string; readonly resultJson: string; readonly createdAt: string; }): unknown; }

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const defaultThresholds: Required<ExecutionCostCollapseThresholds> = Object.freeze({ returnDegradationRatio: 0.5, drawdownExpansionRatio: 0.5, minimumClosedTrades: 2 });
const costLoad = (scenario: ExecutionCostScenario): number => scenario.feeRate * 10_000 + scenario.spreadBps + scenario.slippageBps;
const canonical = (scenario: ExecutionCostScenario): ExecutionCostScenario => freeze({ id: scenario.id, feeRate: scenario.feeRate, spreadBps: scenario.spreadBps, slippageBps: scenario.slippageBps, latencyMs: scenario.latencyMs, label: scenario.label });

function validateScenarios(config: ExecutionCostStressConfig): readonly ExecutionCostScenario[] {
  const minimum = config.minimumScenarioCount ?? 2;
  if (!Number.isInteger(minimum) || minimum < 1 || config.scenarios.length < minimum) throw new Error("stress grid has insufficient scenarios");
  const ids = new Set<string>();
  for (const scenario of config.scenarios) {
    if (!scenario.id || ids.has(scenario.id)) throw new Error("stress scenario ids must be unique and non-empty"); ids.add(scenario.id);
    for (const value of [scenario.feeRate, scenario.spreadBps, scenario.slippageBps, scenario.latencyMs ?? 0]) if (!Number.isFinite(value) || value < 0) throw new Error(`stress scenario ${scenario.id} contains an invalid cost`);
    if (scenario.spreadBps / 2 + scenario.slippageBps >= 10_000) throw new Error(`stress scenario ${scenario.id} would produce a non-positive sell price`);
  }
  if (!ids.has(config.baselineScenarioId)) throw new Error("stress baseline scenario does not exist");
  return Object.freeze([...config.scenarios].map(canonical).sort((left, right) => left.feeRate - right.feeRate || left.spreadBps - right.spreadBps || left.slippageBps - right.slippageBps || left.id.localeCompare(right.id)));
}

function scenarioConfig(config: WalkForwardConfig, scenario: ExecutionCostScenario): WalkForwardConfig {
  return freeze({ ...config, backtestConfig: freeze({ ...(config.backtestConfig ?? {}), feeRate: scenario.feeRate, executionCosts: freeze({ spreadBps: scenario.spreadBps, slippageBps: scenario.slippageBps }) }) });
}

function summarize(scenario: ExecutionCostScenario, selectionMode: CandidateSelectionMode, walkForwardResult: WalkForwardResult): ExecutionCostScenarioResult {
  const metrics = walkForwardResult.combinedOutOfSampleMetrics;
  return freeze({ scenario, selectionMode, walkForwardResult, markedTotalReturn: metrics.markedTotalReturn, markedMaximumDrawdown: metrics.markedMaximumDrawdown, closedTradeNetProfit: metrics.closedTradeNetProfit, closedTradeExpectancy: metrics.closedTradeExpectancy, closedTradeProfitFactor: metrics.closedTradeProfitFactor, totalTradingCost: metrics.totalTradingCost, benchmarkOutperformance: metrics.equalWeight.averageOutperformance, warnings: Object.freeze([...walkForwardResult.warnings, ...(scenario.latencyMs ? ["LATENCY_NOT_MODELED"] : [])]) });
}

function identity(input: StressExperimentIdentityInput, scenarios: readonly ExecutionCostScenario[], mode: CandidateSelectionMode): ExecutionCostStressIdentity {
  if (!/^[a-f0-9]{64}$/i.test(input.datasetSha256)) throw new Error("datasetSha256 must be a SHA-256 hex string");
  if (!input.sourceExperimentSha) throw new Error("sourceExperimentSha is required");
  const grid = JSON.stringify(scenarios.map((scenario) => ({ id: scenario.id, feeRate: scenario.feeRate, spreadBps: scenario.spreadBps, slippageBps: scenario.slippageBps, latencyMs: scenario.latencyMs ?? 0 })));
  const stressGridSha256 = createHash("sha256").update(grid).digest("hex"); const engineVersion = input.engineVersion ?? "execution-cost-stress-v1";
  const id = createHash("sha256").update(`${input.sourceExperimentSha}|${input.datasetSha256}|${stressGridSha256}|${mode}|${engineVersion}`).digest("hex");
  return freeze({ id, sourceExperimentSha: input.sourceExperimentSha, datasetSha256: input.datasetSha256, stressGridSha256, selectionMode: mode, engineVersion });
}

function breakEven(results: readonly ExecutionCostScenarioResult[]): BreakEvenEstimate {
  const ordered = [...results].sort((left, right) => costLoad(left.scenario) - costLoad(right.scenario) || left.scenario.id.localeCompare(right.scenario.id));
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!; const upper = ordered[index]!; const a = lower.closedTradeExpectancy ?? 0; const b = upper.closedTradeExpectancy ?? 0;
    if (a > 0 && b <= 0) {
      const lowCost = costLoad(lower.scenario); const highCost = costLoad(upper.scenario); const ratio = a / (a - b);
      return freeze({ status: "ESTIMATED", label: "ESTIMATED_NOT_EXACT_GRID_DEPENDENT", costLoadBps: lowCost + (highCost - lowCost) * ratio, lowerScenarioId: lower.scenario.id, upperScenarioId: upper.scenario.id });
    }
  }
  return freeze({ status: "NOT_FOUND", label: "BREAK_EVEN_NOT_FOUND" });
}

export function runExecutionCostStress(points: readonly BacktestPoint[], candidates: readonly WalkForwardCandidate[], walkForwardConfig: WalkForwardConfig, config: ExecutionCostStressConfig, identityInput: StressExperimentIdentityInput): ExecutionCostStressResult {
  const scenarios = validateScenarios(config); const mode = config.candidateSelectionMode ?? "RESELECT_PER_SCENARIO"; const thresholds = { ...defaultThresholds, ...(config.collapseThresholds ?? {}) };
  const baselineScenario = scenarios.find((scenario) => scenario.id === config.baselineScenarioId)!;
  const baselineWalkForward = runWalkForward(points, candidates, scenarioConfig(walkForwardConfig, baselineScenario));
  const baseline = summarize(baselineScenario, mode, baselineWalkForward); const baselineSelections = baselineWalkForward.windows.map((window) => window.selectedCandidateId);
  const results = scenarios.map((scenario) => {
    if (scenario.id === baselineScenario.id) return baseline;
    const scenarioResult = mode === "RESELECT_PER_SCENARIO"
      ? runWalkForward(points, candidates, scenarioConfig(walkForwardConfig, scenario))
      : runWalkForwardFixedSelection(points, candidates, scenarioConfig(walkForwardConfig, scenario), baselineSelections);
    return summarize(scenario, mode, scenarioResult);
  });
  const degradation = Object.freeze(results.map((result) => freeze({ scenarioId: result.scenario.id, returnDegradation: baseline.markedTotalReturn - result.markedTotalReturn, drawdownIncrease: result.markedMaximumDrawdown - baseline.markedMaximumDrawdown, expectancyDegradation: baseline.closedTradeExpectancy == null || result.closedTradeExpectancy == null ? undefined : baseline.closedTradeExpectancy - result.closedTradeExpectancy, profitFactorDegradation: baseline.closedTradeProfitFactor == null || result.closedTradeProfitFactor == null ? undefined : baseline.closedTradeProfitFactor - result.closedTradeProfitFactor, performancePerCostBps: costLoad(result.scenario) === costLoad(baseline.scenario) ? undefined : (result.markedTotalReturn - baseline.markedTotalReturn) / (costLoad(result.scenario) - costLoad(baseline.scenario)) })));
  const warnings: string[] = [];
  const highCost = results.filter((result) => costLoad(result.scenario) >= costLoad(baseline.scenario) * 2);
  if (highCost.some((result) => baseline.markedTotalReturn > 0 && (baseline.markedTotalReturn - result.markedTotalReturn) / baseline.markedTotalReturn >= thresholds.returnDegradationRatio)) warnings.push("RETURN_COLLAPSE");
  if (results.some((result) => (result.closedTradeExpectancy ?? 0) < 0)) warnings.push("EXPECTANCY_TURNS_NEGATIVE");
  if (results.some((result) => result.closedTradeProfitFactor != null && result.closedTradeProfitFactor < 1)) warnings.push("PROFIT_FACTOR_BELOW_ONE");
  if (results.some((result) => result.benchmarkOutperformance < 0)) warnings.push("BENCHMARK_EDGE_LOST");
  if (highCost.some((result) => baseline.markedMaximumDrawdown > 0 && (result.markedMaximumDrawdown - baseline.markedMaximumDrawdown) / baseline.markedMaximumDrawdown >= thresholds.drawdownExpansionRatio)) warnings.push("DRAWDOWN_EXPANDS");
  if (results.some((result) => result.walkForwardResult.combinedOutOfSampleMetrics.totalOosClosedTrades < thresholds.minimumClosedTrades)) warnings.push("INSUFFICIENT_CLOSED_TRADES");
  if (mode === "RESELECT_PER_SCENARIO" && results.some((result) => result.walkForwardResult.windows.some((window, index) => window.selectedCandidateId !== baselineSelections[index]))) warnings.push("SCENARIO_SELECTION_UNSTABLE");
  const breakEvenEstimate = breakEven(results); if (breakEvenEstimate.status === "NOT_FOUND") warnings.push("BREAK_EVEN_NOT_FOUND");
  if (warnings.some((warning) => ["RETURN_COLLAPSE", "EXPECTANCY_TURNS_NEGATIVE", "PROFIT_FACTOR_BELOW_ONE"].includes(warning))) warnings.push("COST_FRAGILE");
  const robustnessScore = Math.max(0, Math.min(100, 100 - warnings.length * 12 - Math.max(0, baseline.markedTotalReturn - Math.min(...results.map((result) => result.markedTotalReturn))) * 100));
  return freeze({ selectionMode: mode, baseline, scenarios: Object.freeze(results), degradation, breakEvenEstimate, robustnessScore, identity: identity(identityInput, scenarios, mode), warnings: Object.freeze(warnings) });
}

export function recordStressExperiment(adapter: ResearchMemoryStressAdapter, stress: ExecutionCostStressResult, metadata: { readonly datasetId: string; readonly manifestSchemaVersion: number; readonly market: string; readonly interval: string; readonly startOpenTime: number; readonly endCloseTime: number; readonly createdAt?: string }): unknown {
  return adapter.appendExperiment(freeze({ id: `stress.${stress.identity.id}`, datasetId: metadata.datasetId, contentSha256: stress.identity.datasetSha256, manifestSchemaVersion: metadata.manifestSchemaVersion, market: metadata.market, interval: metadata.interval, startOpenTime: metadata.startOpenTime, endCloseTime: metadata.endCloseTime, walkForwardConfigJson: JSON.stringify({ selectionMode: stress.selectionMode, stressGridSha256: stress.identity.stressGridSha256 }), resultJson: JSON.stringify(stress), createdAt: metadata.createdAt ?? "1970-01-01T00:00:00.000Z" }));
}

