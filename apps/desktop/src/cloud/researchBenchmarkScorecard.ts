import { requireResearchExecutionCostEvidence, type ResearchExperimentResult } from "./researchDataset";

export interface ResearchBenchmarkPolicy {
  readonly minimumWindows?: number;
  readonly minimumOosPoints?: number;
  readonly minimumClosedTrades?: number;
  readonly maximumDrawdown?: number;
  readonly minimumBenchmarkOutperformanceWindowRatio?: number;
  readonly maximumSelectionChurnRatio?: number;
}

export interface ResearchBenchmarkSlice {
  readonly id: string;
  readonly experiment: ResearchExperimentResult;
}

export interface ResearchBenchmarkSliceScore {
  readonly id: string;
  readonly datasetId: string;
  readonly contentSha256: string;
  readonly market: string;
  readonly interval: string;
  readonly candleCount: number;
  readonly windowCount: number;
  readonly totalOosPoints: number;
  readonly totalOosClosedTrades: number;
  readonly totalReturn: number;
  readonly maximumDrawdown: number;
  readonly averageBenchmarkReturn: number;
  readonly averageOutperformance: number;
  readonly profitableWindowRatio: number;
  readonly benchmarkOutperformanceWindowRatio: number;
  readonly turnover: number;
  readonly totalTradingCost: number;
  readonly tradingCostBurden: number;
  readonly selectionChurnRatio: number;
  readonly returnToDrawdown?: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly researchScore?: number;
  readonly rank?: number;
}

export interface ResearchBenchmarkCoverage {
  readonly sliceCount: number;
  readonly markets: readonly string[];
  readonly intervals: readonly string[];
  readonly warnings: readonly string[];
}

export interface ResearchBenchmarkScorecard {
  readonly policy: Required<ResearchBenchmarkPolicy>;
  readonly coverage: ResearchBenchmarkCoverage;
  readonly slices: readonly ResearchBenchmarkSliceScore[];
}

const DEFAULT_POLICY: Required<ResearchBenchmarkPolicy> = Object.freeze({
  minimumWindows: 2,
  minimumOosPoints: 20,
  minimumClosedTrades: 1,
  maximumDrawdown: 0.35,
  minimumBenchmarkOutperformanceWindowRatio: 0.5,
  maximumSelectionChurnRatio: 0.75
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function ratio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
}

function normalizePolicy(policy: ResearchBenchmarkPolicy): Required<ResearchBenchmarkPolicy> {
  const normalized = { ...DEFAULT_POLICY, ...policy };
  for (const [name, value] of [
    ["minimumWindows", normalized.minimumWindows],
    ["minimumOosPoints", normalized.minimumOosPoints],
    ["minimumClosedTrades", normalized.minimumClosedTrades]
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  ratio(normalized.maximumDrawdown, "maximumDrawdown");
  ratio(normalized.minimumBenchmarkOutperformanceWindowRatio, "minimumBenchmarkOutperformanceWindowRatio");
  ratio(normalized.maximumSelectionChurnRatio, "maximumSelectionChurnRatio");
  return freeze(normalized);
}

function validateExecutionCostEvidence(experiment: ResearchExperimentResult): void {
  const costs = experiment.experimentConfig?.executionCosts;
  requireResearchExecutionCostEvidence({
    feeRate: costs?.feeRate,
    executionCosts: {
      spreadBps: costs?.spreadBps,
      slippageBps: costs?.slippageBps,
    },
  });
}

function scoreSlice(slice: ResearchBenchmarkSlice, policy: Required<ResearchBenchmarkPolicy>): ResearchBenchmarkSliceScore {
  validateExecutionCostEvidence(slice.experiment);
  if (!slice.id.trim()) throw new Error("benchmark slice id is required");
  const manifest = slice.experiment.manifest;
  const oos = slice.experiment.walkForwardResult.combinedOutOfSampleMetrics;
  const churn = slice.experiment.walkForwardResult.stabilityDiagnostics.selectionChurnRatio;
  if (oos.equalWeight == null || oos.sequentialCompounded == null) {
    throw new Error("benchmark aggregate evidence is incomplete");
  }
  for (const [name, value] of [
    ["totalReturn", oos.totalReturn],
    ["averageBenchmarkReturn", oos.equalWeight.averageBenchmarkReturn],
    ["averageOutperformance", oos.equalWeight.averageOutperformance],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  for (const [name, value] of [
    ["windowCount", oos.windowCount],
    ["totalOosPoints", oos.totalOosPoints],
    ["totalOosClosedTrades", oos.totalOosClosedTrades],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (!Number.isFinite(oos.sequentialCompounded.initialEquity) || oos.sequentialCompounded.initialEquity <= 0) {
    throw new Error("initialEquity must be positive and finite");
  }
  finiteNonNegative(oos.maximumDrawdown, "maximumDrawdown");
  finiteNonNegative(oos.turnover, "turnover");
  finiteNonNegative(oos.totalTradingCost, "totalTradingCost");
  ratio(oos.profitableWindowRatio, "profitableWindowRatio");
  ratio(oos.benchmarkOutperformanceWindowRatio, "benchmarkOutperformanceWindowRatio");
  ratio(churn, "selectionChurnRatio");

  const reasons: string[] = [];
  if (oos.windowCount < policy.minimumWindows) reasons.push("MINIMUM_WINDOWS_NOT_MET");
  if (oos.totalOosPoints < policy.minimumOosPoints) reasons.push("MINIMUM_OOS_POINTS_NOT_MET");
  if (oos.totalOosClosedTrades < policy.minimumClosedTrades) reasons.push("MINIMUM_CLOSED_TRADES_NOT_MET");
  if (oos.maximumDrawdown > policy.maximumDrawdown) reasons.push("MAXIMUM_DRAWDOWN_EXCEEDED");
  if (oos.benchmarkOutperformanceWindowRatio < policy.minimumBenchmarkOutperformanceWindowRatio) reasons.push("BENCHMARK_OUTPERFORMANCE_RATIO_NOT_MET");
  if (churn > policy.maximumSelectionChurnRatio) reasons.push("SELECTION_CHURN_EXCEEDED");

  const initialEquity = oos.sequentialCompounded.initialEquity;
  const tradingCostBurden = initialEquity > 0 ? oos.totalTradingCost / initialEquity : 0;
  const returnToDrawdown = oos.maximumDrawdown > 0 ? oos.totalReturn / oos.maximumDrawdown : undefined;
  const eligible = reasons.length === 0;
  const researchScore = eligible
    ? oos.totalReturn * 1_000
      + oos.equalWeight.averageOutperformance * 500
      + oos.profitableWindowRatio * 50
      + oos.benchmarkOutperformanceWindowRatio * 100
      - oos.maximumDrawdown * 500
      - churn * 50
      - tradingCostBurden * 1_000
    : undefined;

  return freeze({
    id: slice.id,
    datasetId: manifest.datasetId,
    contentSha256: manifest.contentSha256,
    market: manifest.market,
    interval: manifest.interval,
    candleCount: manifest.candleCount,
    windowCount: oos.windowCount,
    totalOosPoints: oos.totalOosPoints,
    totalOosClosedTrades: oos.totalOosClosedTrades,
    totalReturn: oos.totalReturn,
    maximumDrawdown: oos.maximumDrawdown,
    averageBenchmarkReturn: oos.equalWeight.averageBenchmarkReturn,
    averageOutperformance: oos.equalWeight.averageOutperformance,
    profitableWindowRatio: oos.profitableWindowRatio,
    benchmarkOutperformanceWindowRatio: oos.benchmarkOutperformanceWindowRatio,
    turnover: oos.turnover,
    totalTradingCost: oos.totalTradingCost,
    tradingCostBurden,
    selectionChurnRatio: churn,
    returnToDrawdown,
    eligible,
    reasons: Object.freeze(reasons),
    researchScore
  });
}

function coverage(scores: readonly ResearchBenchmarkSliceScore[]): ResearchBenchmarkCoverage {
  const markets = [...new Set(scores.map((score) => score.market))].sort();
  const intervals = [...new Set(scores.map((score) => score.interval))].sort();
  const warnings: string[] = [];
  if (scores.length < 3) warnings.push("FEWER_THAN_THREE_RESEARCH_SLICES");
  if (markets.length < 2) warnings.push("SINGLE_MARKET_COVERAGE");
  if (intervals.length < 2) warnings.push("SINGLE_INTERVAL_COVERAGE");
  return freeze({ sliceCount: scores.length, markets: Object.freeze(markets), intervals: Object.freeze(intervals), warnings: Object.freeze(warnings) });
}

export function createResearchBenchmarkScorecard(
  slices: readonly ResearchBenchmarkSlice[],
  policy: ResearchBenchmarkPolicy = {}
): ResearchBenchmarkScorecard {
  if (slices.length === 0) throw new Error("benchmark scorecard requires at least one slice");
  const ids = new Set<string>();
  for (const slice of slices) {
    if (!slice.id.trim() || ids.has(slice.id)) throw new Error("benchmark slice ids must be unique and non-empty");
    ids.add(slice.id);
  }
  const normalizedPolicy = normalizePolicy(policy);
  const scored = slices.map((slice) => scoreSlice(slice, normalizedPolicy));
  const rankedEligible = scored
    .filter((score) => score.eligible && score.researchScore != null)
    .sort((left, right) => right.researchScore! - left.researchScore! || left.id.localeCompare(right.id));
  const ranks = new Map(rankedEligible.map((score, index) => [score.id, index + 1] as const));
  const output = scored
    .map((score) => freeze({ ...score, rank: ranks.get(score.id) }))
    .sort((left, right) => (left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id));
  return freeze({ policy: normalizedPolicy, coverage: coverage(output), slices: Object.freeze(output) });
}
