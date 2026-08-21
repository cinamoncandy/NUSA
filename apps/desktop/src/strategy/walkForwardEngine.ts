import { analyzeEquityCurve, calculatePerformanceMetrics, type EquityAnalytics, type MatchedTrade } from "./backtestAnalytics";
import { runBacktest, type BacktestConfig, type BacktestPoint, type BacktestResult } from "./backtestEngine";
import type { TradingStrategy } from "./strategyEngine";

export interface WalkForwardWindow {
  readonly index: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly trainPoints: readonly BacktestPoint[];
  readonly testPoints: readonly BacktestPoint[];
}

export interface WalkForwardConfig {
  readonly trainSize: number;
  readonly testSize: number;
  readonly stepSize?: number;
  readonly anchored?: boolean;
  readonly minimumWindows?: number;
  readonly backtestConfig?: BacktestConfig;
  readonly selectionPolicy?: WalkForwardSelectionPolicy;
}

export interface WalkForwardCandidate {
  readonly id: string;
  readonly strategyFactory: () => TradingStrategy;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface CandidateScore {
  readonly candidateId: string;
  readonly score?: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly result: BacktestResult;
}

export interface WalkForwardSelectionPolicy {
  readonly minimumClosedTrades?: number;
  readonly maximumDrawdown?: number;
  readonly requirePositiveReturn?: boolean;
  readonly turnoverPenalty?: number;
  readonly tradingCostPenalty?: number;
}

export interface WalkForwardWindowResult {
  readonly window: WalkForwardWindow;
  readonly selectedCandidateId: string;
  readonly trainResult: BacktestResult;
  readonly testResult: BacktestResult;
  readonly candidateTrainScores: readonly CandidateScore[];
  readonly selectionReason: string;
}

export interface EqualWeightOutOfSampleMetrics {
  readonly averageReturn: number;
  readonly averageBenchmarkReturn: number;
  readonly averageOutperformance: number;
}

export interface SequentialCompoundedOutOfSampleMetrics {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly totalReturn: number;
  readonly maximumDrawdown: number;
}

export interface CombinedOutOfSampleMetrics {
  readonly closedTradeNetProfit: number;
  readonly closedTradeProfitFactor?: number;
  readonly closedTradeExpectancy?: number;
  readonly markedTotalReturn: number;
  readonly markedMaximumDrawdown: number;
  readonly windowCount: number;
  readonly totalOosPoints: number;
  readonly totalOosClosedTrades: number;
  readonly netProfit: number;
  readonly totalReturn: number;
  readonly maximumDrawdown: number;
  readonly profitFactor?: number;
  readonly expectancy?: number;
  readonly winRate: number;
  readonly averageWin?: number;
  readonly averageLoss?: number;
  readonly payoffRatio?: number;
  readonly turnover: number;
  readonly exposure: number;
  readonly fees: number;
  readonly spreadCost: number;
  readonly slippageCost: number;
  readonly totalTradingCost: number;
  readonly profitableWindowRatio: number;
  readonly positiveExpectancyWindowRatio: number;
  readonly benchmarkOutperformanceWindowRatio: number;
  readonly equalWeight: EqualWeightOutOfSampleMetrics;
  readonly sequentialCompounded: SequentialCompoundedOutOfSampleMetrics;
}

export interface CandidateStabilityDiagnostic {
  readonly candidateId: string;
  readonly selectedWindowCount: number;
  readonly selectionRatio: number;
  readonly trainSuccessCount: number;
  readonly oosProfitableCount: number;
  readonly oosPositiveExpectancyCount: number;
  readonly averageTrainScore?: number;
  readonly averageOosReturn?: number;
  readonly averageOosDrawdown?: number;
  readonly trainOosReturnGap?: number;
}

export interface StabilityDiagnostics {
  readonly candidates: readonly CandidateStabilityDiagnostic[];
  readonly selectionChurn: number;
  readonly selectionChurnRatio: number;
}

export interface WalkForwardResult {
  readonly windows: readonly WalkForwardWindowResult[];
  readonly combinedOutOfSampleMetrics: CombinedOutOfSampleMetrics;
  readonly candidateSelectionCounts: Readonly<Record<string, number>>;
  readonly stabilityDiagnostics: StabilityDiagnostics;
  readonly warnings: readonly string[];
}

const DEFAULT_SELECTION_POLICY: Required<WalkForwardSelectionPolicy> = Object.freeze({ minimumClosedTrades: 1, maximumDrawdown: 1, requirePositiveReturn: false, turnoverPenalty: 0, tradingCostPenalty: 0 });

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const positiveInteger = (value: number, name: string): void => { if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); };

function validatePoints(points: readonly BacktestPoint[]): void {
  let prior = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || point.timestamp <= prior) throw new Error("walk forward timestamps must be finite and strictly increasing");
    if (!Number.isFinite(point.close) || point.close <= 0) throw new Error("walk forward close must be positive and finite");
    prior = point.timestamp;
  }
}

function normalizePolicy(policy: WalkForwardSelectionPolicy | undefined): Required<WalkForwardSelectionPolicy> {
  const normalized = { ...DEFAULT_SELECTION_POLICY, ...policy };
  if (!Number.isInteger(normalized.minimumClosedTrades) || normalized.minimumClosedTrades < 0) throw new Error("minimumClosedTrades must be a non-negative integer");
  if (!Number.isFinite(normalized.maximumDrawdown) || normalized.maximumDrawdown < 0 || normalized.maximumDrawdown > 1) throw new Error("maximumDrawdown must be between 0 and 1");
  if (!Number.isFinite(normalized.turnoverPenalty) || normalized.turnoverPenalty < 0 || !Number.isFinite(normalized.tradingCostPenalty) || normalized.tradingCostPenalty < 0) throw new Error("selection penalties must be finite and non-negative");
  return freeze(normalized);
}

function normalizeCandidates(candidates: readonly WalkForwardCandidate[]): readonly WalkForwardCandidate[] {
  if (candidates.length === 0) throw new Error("walk forward requires at least one candidate");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id || ids.has(candidate.id)) throw new Error("walk forward candidate ids must be unique and non-empty");
    if (typeof candidate.strategyFactory !== "function") throw new Error(`candidate ${candidate.id} strategyFactory is required`);
    ids.add(candidate.id);
  }
  return Object.freeze([...candidates].sort((left, right) => left.id.localeCompare(right.id)));
}

export function createWalkForwardWindows(points: readonly BacktestPoint[], config: WalkForwardConfig): { readonly windows: readonly WalkForwardWindow[]; readonly warnings: readonly string[] } {
  validatePoints(points); positiveInteger(config.trainSize, "trainSize"); positiveInteger(config.testSize, "testSize");
  const stepSize = config.stepSize ?? config.testSize; positiveInteger(stepSize, "stepSize");
  if (stepSize < config.testSize) throw new Error("walk forward stepSize must not overlap test windows");
  const windows: WalkForwardWindow[] = []; const warnings: string[] = [];
  for (let index = 0, testStart = config.trainSize; testStart < points.length; index += 1, testStart += stepSize) {
    const testEnd = testStart + config.testSize - 1;
    if (testEnd >= points.length) { warnings.push("INCOMPLETE_TEST_WINDOW_EXCLUDED"); break; }
    const trainStart = config.anchored ? 0 : testStart - config.trainSize;
    const trainEnd = testStart - 1;
    windows.push(freeze({ index, trainStart, trainEnd, testStart, testEnd, trainPoints: Object.freeze(points.slice(trainStart, testStart)), testPoints: Object.freeze(points.slice(testStart, testEnd + 1)) }));
  }
  if (windows.length < (config.minimumWindows ?? 1)) throw new Error("walk forward does not have the minimum complete windows");
  return freeze({ windows: Object.freeze(windows), warnings: Object.freeze(warnings) });
}

export function scoreCandidateTrainResult(candidateId: string, result: BacktestResult, policy: WalkForwardSelectionPolicy = {}): CandidateScore {
  const normalized = normalizePolicy(policy); const reasons: string[] = [];
  if (result.performance.trades < normalized.minimumClosedTrades) reasons.push("MINIMUM_CLOSED_TRADES_NOT_MET");
  if (result.metrics.maxDrawdown > normalized.maximumDrawdown) reasons.push("MAXIMUM_DRAWDOWN_EXCEEDED");
  if (normalized.requirePositiveReturn && result.metrics.totalReturn <= 0) reasons.push("NON_POSITIVE_TRAIN_RETURN");
  if (reasons.length > 0) return freeze({ candidateId, eligible: false, reasons: Object.freeze(reasons), result });
  const initial = result.metrics.initialEquity;
  const score = result.metrics.totalReturn * 1_000 + (result.performance.expectancy ?? 0) / initial * 1_000 + (result.performance.profitFactor ?? 0) - result.metrics.maxDrawdown * 100 - result.metrics.turnover * normalized.turnoverPenalty - result.metrics.totalTradingCost / initial * normalized.tradingCostPenalty;
  return freeze({ candidateId, score, eligible: true, reasons: Object.freeze(reasons), result });
}

function candidateResult(candidate: WalkForwardCandidate, points: readonly BacktestPoint[], config: BacktestConfig): BacktestResult {
  try { return runBacktest(points, candidate.strategyFactory, config); }
  catch (error) { throw new Error(`candidate ${candidate.id} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}

function selectCandidate(candidates: readonly WalkForwardCandidate[], trainPoints: readonly BacktestPoint[], config: WalkForwardConfig): { selected: CandidateScore; all: readonly CandidateScore[] } {
  const scores = candidates.map((candidate) => scoreCandidateTrainResult(candidate.id, candidateResult(candidate, trainPoints, config.backtestConfig ?? {}), config.selectionPolicy));
  const eligible = scores.filter((score) => score.eligible && score.score != null).sort((left, right) => right.score! - left.score! || left.candidateId.localeCompare(right.candidateId));
  if (eligible.length === 0) throw new Error("walk forward has no eligible candidate from train-only evidence");
  return { selected: eligible[0]!, all: Object.freeze(scores) };
}

function allTrades(windows: readonly WalkForwardWindowResult[]): readonly MatchedTrade[] { return Object.freeze(windows.flatMap((window) => window.testResult.trades)); }

function combinedMetrics(windows: readonly WalkForwardWindowResult[]): CombinedOutOfSampleMetrics {
  const tests = windows.map((window) => window.testResult); const trades = allTrades(windows);
  const totalDuration = tests.reduce((sum, result) => sum + Math.max(0, result.equityCurve.at(-1)!.timestamp - result.equityCurve[0]!.timestamp), 0);
  const exposure = totalDuration === 0 ? 0 : tests.reduce((sum, result) => sum + result.performance.exposure * Math.max(0, result.equityCurve.at(-1)!.timestamp - result.equityCurve[0]!.timestamp), 0) / totalDuration;
  const performance = calculatePerformanceMetrics(trades, exposure);
  const initialEquity = tests[0]?.metrics.initialEquity ?? 0;
  let sequentialEquity = initialEquity;
  const sequentialCurve: Array<{ timestamp: number; equity: number }> = [];
  for (const result of tests) {
    const base = result.metrics.initialEquity;
    for (const point of result.equityCurve) sequentialCurve.push(freeze({ timestamp: point.timestamp, equity: sequentialEquity * point.equity / base }));
    sequentialEquity *= 1 + result.metrics.totalReturn;
  }
  const sequentialAnalytics: EquityAnalytics = sequentialCurve.length ? analyzeEquityCurve(sequentialCurve, sequentialEquity - initialEquity) : freeze({ maximumDrawdown: 0, longestDrawdown: 0, ulcerIndex: 0, equityCurveCsv: "timestamp,equity\n" });
  const count = tests.length;
  const average = (values: readonly number[]): number => count === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / count;
  return freeze({
    closedTradeNetProfit: performance.netProfit, closedTradeProfitFactor: performance.profitFactor, closedTradeExpectancy: performance.expectancy,
    windowCount: count, totalOosPoints: windows.reduce((sum, window) => sum + window.window.testPoints.length, 0), totalOosClosedTrades: performance.trades, netProfit: performance.netProfit,
    markedTotalReturn: initialEquity === 0 ? 0 : sequentialEquity / initialEquity - 1, markedMaximumDrawdown: sequentialAnalytics.maximumDrawdown,
    totalReturn: initialEquity === 0 ? 0 : sequentialEquity / initialEquity - 1,
    maximumDrawdown: sequentialAnalytics.maximumDrawdown, profitFactor: performance.profitFactor, expectancy: performance.expectancy, winRate: performance.winRate, averageWin: performance.averageWin, averageLoss: performance.averageLoss, payoffRatio: performance.payoffRatio, turnover: tests.reduce((sum, result) => sum + result.metrics.turnover, 0), exposure,
    fees: tests.reduce((sum, result) => sum + result.metrics.feesPaid, 0), spreadCost: tests.reduce((sum, result) => sum + result.metrics.spreadCost, 0), slippageCost: tests.reduce((sum, result) => sum + result.metrics.slippageCost, 0), totalTradingCost: tests.reduce((sum, result) => sum + result.metrics.totalTradingCost, 0),
    profitableWindowRatio: average(tests.map((result) => result.metrics.totalReturn > 0 ? 1 : 0)), positiveExpectancyWindowRatio: average(tests.map((result) => (result.performance.expectancy ?? 0) > 0 ? 1 : 0)), benchmarkOutperformanceWindowRatio: average(tests.map((result) => result.benchmark.outperformance > 0 ? 1 : 0)),
    equalWeight: freeze({ averageReturn: average(tests.map((result) => result.metrics.totalReturn)), averageBenchmarkReturn: average(tests.map((result) => result.benchmark.buyAndHoldReturn)), averageOutperformance: average(tests.map((result) => result.benchmark.outperformance)) }),
    sequentialCompounded: freeze({ initialEquity, finalEquity: sequentialEquity, totalReturn: initialEquity === 0 ? 0 : sequentialEquity / initialEquity - 1, maximumDrawdown: sequentialAnalytics.maximumDrawdown })
  });
}

function diagnostics(candidates: readonly WalkForwardCandidate[], windows: readonly WalkForwardWindowResult[]): StabilityDiagnostics {
  const selected = windows.map((window) => window.selectedCandidateId); const churn = selected.slice(1).filter((id, index) => id !== selected[index]).length;
  const rows = candidates.map((candidate) => {
    const related = windows.filter((window) => window.selectedCandidateId === candidate.id); const trainScores = related.map((window) => window.candidateTrainScores.find((score) => score.candidateId === candidate.id)!);
    const average = (values: readonly number[]): number | undefined => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
    const averageTrainReturn = average(related.map((window) => window.trainResult.metrics.totalReturn)); const averageOosReturn = average(related.map((window) => window.testResult.metrics.totalReturn));
    return freeze({ candidateId: candidate.id, selectedWindowCount: related.length, selectionRatio: windows.length ? related.length / windows.length : 0, trainSuccessCount: related.filter((window) => window.trainResult.metrics.totalReturn > 0).length, oosProfitableCount: related.filter((window) => window.testResult.metrics.totalReturn > 0).length, oosPositiveExpectancyCount: related.filter((window) => (window.testResult.performance.expectancy ?? 0) > 0).length, averageTrainScore: average(trainScores.map((score) => score.score ?? 0)), averageOosReturn, averageOosDrawdown: average(related.map((window) => window.testResult.metrics.maxDrawdown)), trainOosReturnGap: averageTrainReturn != null && averageOosReturn != null ? averageTrainReturn - averageOosReturn : undefined });
  });
  return freeze({ candidates: Object.freeze(rows), selectionChurn: churn, selectionChurnRatio: windows.length <= 1 ? 0 : churn / (windows.length - 1) });
}

function warnings(combined: CombinedOutOfSampleMetrics, diagnostic: StabilityDiagnostics): readonly string[] {
  const warnings: string[] = [];
  if (diagnostic.candidates.some((candidate) => diagnostic.candidates.length > 1 && candidate.selectionRatio >= 0.8)) warnings.push("CANDIDATE_SELECTION_DOMINANCE");
  if (diagnostic.selectionChurnRatio >= 0.5) warnings.push("HIGH_SELECTION_CHURN");
  if (diagnostic.candidates.some((candidate) => candidate.trainSuccessCount >= 1 && candidate.oosProfitableCount < candidate.trainSuccessCount)) warnings.push("TRAIN_OOS_PERFORMANCE_DIVERGENCE");
  if (combined.totalOosClosedTrades < Math.max(2, combined.windowCount)) warnings.push("INSUFFICIENT_CLOSED_TRADE_SAMPLE");
  if (combined.totalTradingCost > combined.fees && combined.netProfit <= 0) warnings.push("COSTS_DOMINATE_OOS_PERFORMANCE");
  const contributions = diagnostic.candidates.map((candidate) => Math.abs((candidate.averageOosReturn ?? 0) * candidate.selectedWindowCount)); const total = contributions.reduce((sum, value) => sum + value, 0);
  if (combined.windowCount >= 3 && total > 0 && Math.max(...contributions) / total >= 0.8) warnings.push("OOS_RESULTS_CONCENTRATED_IN_FEW_WINDOWS");
  return Object.freeze(warnings);
}

export function runWalkForward(points: readonly BacktestPoint[], candidates: readonly WalkForwardCandidate[], config: WalkForwardConfig): WalkForwardResult {
  const normalizedCandidates = normalizeCandidates(candidates); const plan = createWalkForwardWindows(points, config);
  const windows = plan.windows.map((window) => {
    const selection = selectCandidate(normalizedCandidates, window.trainPoints, config);
    const candidate = normalizedCandidates.find((item) => item.id === selection.selected.candidateId)!;
    const testResult = candidateResult(candidate, window.testPoints, config.backtestConfig ?? {});
    return freeze({ window, selectedCandidateId: candidate.id, trainResult: selection.selected.result, testResult, candidateTrainScores: selection.all, selectionReason: `highest eligible train-only score: ${selection.selected.score}` });
  });
  const combinedOutOfSampleMetrics = combinedMetrics(windows); const stabilityDiagnostics = diagnostics(normalizedCandidates, windows);
  const openPositionWarnings = windows.some((window) => window.testResult.openPosition.status === "OPEN_POSITION") ? ["OPEN_POSITION_MARKED_AT_WINDOW_END"] : [];
  return freeze({ windows: Object.freeze(windows), combinedOutOfSampleMetrics, candidateSelectionCounts: freeze(Object.fromEntries(normalizedCandidates.map((candidate) => [candidate.id, windows.filter((window) => window.selectedCandidateId === candidate.id).length]))), stabilityDiagnostics, warnings: Object.freeze([...plan.warnings, ...warnings(combinedOutOfSampleMetrics, stabilityDiagnostics), ...openPositionWarnings]) });
}

export function runWalkForwardFixedSelection(points: readonly BacktestPoint[], candidates: readonly WalkForwardCandidate[], config: WalkForwardConfig, selectedCandidateIds: readonly string[]): WalkForwardResult {
  const normalizedCandidates = normalizeCandidates(candidates); const plan = createWalkForwardWindows(points, config);
  if (selectedCandidateIds.length !== plan.windows.length) throw new Error("fixed selection count must match complete walk forward windows");
  const windows = plan.windows.map((window) => {
    const selectedCandidateId = selectedCandidateIds[window.index]!;
    const candidate = normalizedCandidates.find((item) => item.id === selectedCandidateId);
    if (!candidate) throw new Error(`fixed selection candidate does not exist: ${selectedCandidateId}`);
    const trainResult = candidateResult(candidate, window.trainPoints, config.backtestConfig ?? {});
    const testResult = candidateResult(candidate, window.testPoints, config.backtestConfig ?? {});
    const score = scoreCandidateTrainResult(candidate.id, trainResult, config.selectionPolicy);
    return freeze({ window, selectedCandidateId: candidate.id, trainResult, testResult, candidateTrainScores: Object.freeze([score]), selectionReason: "fixed baseline train selection" });
  });
  const combinedOutOfSampleMetrics = combinedMetrics(windows); const stabilityDiagnostics = diagnostics(normalizedCandidates, windows);
  const openPositionWarnings = windows.some((window) => window.testResult.openPosition.status === "OPEN_POSITION") ? ["OPEN_POSITION_MARKED_AT_WINDOW_END"] : [];
  return freeze({ windows: Object.freeze(windows), combinedOutOfSampleMetrics, candidateSelectionCounts: freeze(Object.fromEntries(normalizedCandidates.map((candidate) => [candidate.id, windows.filter((window) => window.selectedCandidateId === candidate.id).length]))), stabilityDiagnostics, warnings: Object.freeze([...plan.warnings, ...warnings(combinedOutOfSampleMetrics, stabilityDiagnostics), ...openPositionWarnings]) });
}

