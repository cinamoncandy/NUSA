import type { ResearchExperimentResult } from "./researchDataset";
import type { RegimeHealthAssessment } from "./regimeHealth";

export type RegimeBucket = "HEALTHY" | "MIXED" | "STRESSED";

export interface RegimeWindowEvidence {
  readonly windowIndex: number;
  /** Point-in-time regime assessment available no later than the first OOS point. */
  readonly regime: RegimeHealthAssessment;
}

export interface RegimeAwareEvaluationPolicy {
  readonly minimumWindowsPerRegime?: number;
}

export interface RegimePerformanceSlice {
  readonly regime: RegimeBucket;
  readonly sufficientEvidence: boolean;
  readonly windowCount: number;
  readonly oosPointCount: number;
  readonly closedTradeCount: number;
  readonly averageReturn?: number;
  readonly averageBenchmarkExcess?: number;
  readonly maximumDrawdown?: number;
  readonly totalTradingCost?: number;
  readonly tradingCostBurden?: number;
  readonly profitableWindowRatio?: number;
  readonly reasons: readonly string[];
}

export interface RegimeAwareStrategyEvaluation {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly contentSha256: string;
  readonly generatedAt: string;
  readonly policy: Readonly<{ minimumWindowsPerRegime: number }>;
  readonly slices: readonly RegimePerformanceSlice[];
  readonly observedRegimeCount: number;
  readonly sufficientRegimeCount: number;
  readonly regimeRobustnessScore?: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class RegimeAwareEvaluationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RegimeAwareEvaluationError";
  }
}

const REGIMES: readonly RegimeBucket[] = Object.freeze(["HEALTHY", "MIXED", "STRESSED"]);
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new RegimeAwareEvaluationError(code, message);
}

function normalizePolicy(policy: RegimeAwareEvaluationPolicy): Readonly<{ minimumWindowsPerRegime: number }> {
  const minimumWindowsPerRegime = policy.minimumWindowsPerRegime ?? 2;
  if (!Number.isInteger(minimumWindowsPerRegime) || minimumWindowsPerRegime < 1) {
    throw new RegimeAwareEvaluationError("INVALID_POLICY", "minimumWindowsPerRegime must be a positive integer");
  }
  return freeze({ minimumWindowsPerRegime });
}

function validateEvidence(experiment: ResearchExperimentResult, evidence: readonly RegimeWindowEvidence[]): Map<number, RegimeHealthAssessment> {
  if (evidence.length !== experiment.walkForwardResult.windows.length) {
    throw new RegimeAwareEvaluationError("INCOMPLETE_REGIME_EVIDENCE", "every OOS walk-forward window requires one regime assessment");
  }
  const byWindow = new Map<number, RegimeHealthAssessment>();
  for (const item of evidence) {
    if (!Number.isInteger(item.windowIndex) || item.windowIndex < 0 || byWindow.has(item.windowIndex)) {
      throw new RegimeAwareEvaluationError("INVALID_WINDOW_IDENTITY", "regime evidence window indexes must be unique non-negative integers");
    }
    const window = experiment.walkForwardResult.windows.find((candidate) => candidate.window.index === item.windowIndex);
    if (window == null) throw new RegimeAwareEvaluationError("UNKNOWN_WINDOW", `regime evidence references unknown window ${item.windowIndex}`);
    if (item.regime.schemaVersion !== 1) throw new RegimeAwareEvaluationError("UNSUPPORTED_REGIME_SCHEMA", "regime evidence schema is unsupported");
    if (!REGIMES.includes(item.regime.state)) throw new RegimeAwareEvaluationError("INVALID_REGIME", "regime state is unsupported");
    const firstOosTimestamp = window.window.testPoints[0]?.timestamp;
    if (firstOosTimestamp == null) throw new RegimeAwareEvaluationError("EMPTY_OOS_WINDOW", `window ${item.windowIndex} has no OOS points`);
    if (!Number.isFinite(item.regime.asOf) || item.regime.asOf > firstOosTimestamp) {
      throw new RegimeAwareEvaluationError("LOOKAHEAD_REGIME_EVIDENCE", `window ${item.windowIndex} regime evidence is later than the first OOS timestamp`);
    }
    if (!item.regime.sourceDatasetIds.includes(experiment.manifest.datasetId)) {
      throw new RegimeAwareEvaluationError("REGIME_PROVENANCE_MISMATCH", `window ${item.windowIndex} regime evidence does not cover experiment dataset`);
    }
    byWindow.set(item.windowIndex, item.regime);
  }
  return byWindow;
}

function sliceForRegime(
  experiment: ResearchExperimentResult,
  byWindow: ReadonlyMap<number, RegimeHealthAssessment>,
  regime: RegimeBucket,
  minimumWindowsPerRegime: number,
): RegimePerformanceSlice {
  const windows = experiment.walkForwardResult.windows.filter((window) => byWindow.get(window.window.index)?.state === regime);
  if (windows.length === 0) {
    return freeze({
      regime,
      sufficientEvidence: false,
      windowCount: 0,
      oosPointCount: 0,
      closedTradeCount: 0,
      reasons: freeze(["REGIME_NOT_OBSERVED"]),
    });
  }

  const returns = windows.map((window) => window.testResult.metrics.totalReturn);
  const benchmarkExcess = windows.map((window) => window.testResult.benchmark.outperformance);
  const drawdowns = windows.map((window) => window.testResult.metrics.maxDrawdown);
  const tradingCosts = windows.map((window) => window.testResult.metrics.totalTradingCost);
  for (const value of [...returns, ...benchmarkExcess, ...drawdowns, ...tradingCosts]) {
    assertFinite(value, "NON_FINITE_OOS_EVIDENCE", `non-finite OOS metric in ${regime} regime`);
  }
  const initialEquity = windows.reduce((sum, window) => sum + window.testResult.metrics.initialEquity, 0);
  const totalTradingCost = tradingCosts.reduce((sum, value) => sum + value, 0);
  const sufficientEvidence = windows.length >= minimumWindowsPerRegime;
  const reasons = sufficientEvidence ? [] : ["INSUFFICIENT_REGIME_WINDOWS"];
  const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

  return freeze({
    regime,
    sufficientEvidence,
    windowCount: windows.length,
    oosPointCount: windows.reduce((sum, window) => sum + window.window.testPoints.length, 0),
    closedTradeCount: windows.reduce((sum, window) => sum + window.testResult.performance.trades, 0),
    averageReturn: average(returns),
    averageBenchmarkExcess: average(benchmarkExcess),
    maximumDrawdown: Math.max(...drawdowns),
    totalTradingCost,
    tradingCostBurden: initialEquity > 0 ? totalTradingCost / initialEquity : 0,
    profitableWindowRatio: returns.filter((value) => value > 0).length / returns.length,
    reasons: freeze(reasons),
  });
}

function robustnessScore(slices: readonly RegimePerformanceSlice[]): number | undefined {
  const sufficient = slices.filter((slice) => slice.sufficientEvidence && slice.averageReturn != null && slice.maximumDrawdown != null);
  if (sufficient.length < 2) return undefined;
  const utilities = sufficient.map((slice) => {
    const excess = slice.averageBenchmarkExcess ?? 0;
    const cost = slice.tradingCostBurden ?? 0;
    return slice.averageReturn! + excess - slice.maximumDrawdown! - cost;
  });
  const worst = Math.min(...utilities);
  const best = Math.max(...utilities);
  const spreadPenalty = Math.min(1, Math.max(0, best - worst));
  const worstUtilityScore = Math.max(0, Math.min(1, 0.5 + worst * 5));
  return Math.max(0, Math.min(1, worstUtilityScore * (1 - 0.5 * spreadPenalty)));
}

/**
 * Evaluates already-produced walk-forward OOS windows by the market regime known at each window's
 * start. This function never derives a regime from future data, never reruns a strategy, and never
 * grants promotion, sizing, order, broker, or LIVE authority.
 */
export function evaluateStrategyByRegime(
  experiment: ResearchExperimentResult,
  evidence: readonly RegimeWindowEvidence[],
  policy: RegimeAwareEvaluationPolicy = {},
): RegimeAwareStrategyEvaluation {
  const normalizedPolicy = normalizePolicy(policy);
  const byWindow = validateEvidence(experiment, evidence);
  const slices = REGIMES.map((regime) => sliceForRegime(experiment, byWindow, regime, normalizedPolicy.minimumWindowsPerRegime));
  const observedRegimeCount = slices.filter((slice) => slice.windowCount > 0).length;
  const sufficientRegimeCount = slices.filter((slice) => slice.sufficientEvidence).length;
  const score = robustnessScore(slices);
  const reasons: string[] = [];
  if (observedRegimeCount < 2) reasons.push("INSUFFICIENT_REGIME_DIVERSITY");
  if (score == null) reasons.push("INSUFFICIENT_ROBUSTNESS_EVIDENCE");

  const provenance = new Set<string>([experiment.manifest.datasetId]);
  for (const item of evidence) for (const id of item.regime.sourceDatasetIds) provenance.add(id);

  return freeze({
    schemaVersion: 1,
    datasetId: experiment.manifest.datasetId,
    contentSha256: experiment.manifest.contentSha256,
    generatedAt: experiment.generatedAt,
    policy: normalizedPolicy,
    slices: freeze(slices),
    observedRegimeCount,
    sufficientRegimeCount,
    ...(score == null ? {} : { regimeRobustnessScore: score }),
    reasons: freeze(reasons),
    sourceDatasetIds: freeze([...provenance].sort()),
  });
}
