import { runBacktest, type BacktestConfig, type BacktestPoint, type BacktestResult } from "./backtestEngine";
import type { TradingStrategy } from "./strategyEngine";

export interface WalkForwardCandidate {
  readonly id: string;
  readonly createStrategy: () => TradingStrategy;
}

export interface WalkForwardConfig {
  readonly trainingPoints: number;
  readonly testPoints: number;
  readonly stepPoints?: number;
  readonly backtest?: BacktestConfig;
}

export interface WalkForwardWindow {
  readonly index: number;
  readonly trainingStart: number;
  readonly trainingEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly selectedCandidateId: string;
  readonly trainingResult: BacktestResult;
  readonly testResult: BacktestResult;
}

export interface WalkForwardSummary {
  readonly windows: number;
  readonly outOfSampleReturn: number;
  readonly buyAndHoldReturn: number;
  readonly outperformance: number;
  readonly selectedCandidates: readonly string[];
}

export interface WalkForwardResult {
  readonly windows: readonly WalkForwardWindow[];
  readonly summary: WalkForwardSummary;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function validateCandidates(candidates: readonly WalkForwardCandidate[]): readonly WalkForwardCandidate[] {
  if (candidates.length === 0) throw new Error("walk forward requires at least one candidate");
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id || seen.has(candidate.id)) throw new Error("walk forward candidate ids must be unique and non-empty");
    seen.add(candidate.id);
  }
  return [...candidates].sort((left, right) => left.id.localeCompare(right.id));
}

function selectCandidate(points: readonly BacktestPoint[], candidates: readonly WalkForwardCandidate[], config: BacktestConfig): { candidate: WalkForwardCandidate; result: BacktestResult } {
  let selected: { candidate: WalkForwardCandidate; result: BacktestResult } | undefined;
  for (const candidate of candidates) {
    const result = runBacktest(points, candidate.createStrategy, config);
    if (selected == null || result.metrics.totalReturn > selected.result.metrics.totalReturn) selected = { candidate, result };
  }
  return selected!;
}

export function runWalkForward(
  points: readonly BacktestPoint[],
  candidates: readonly WalkForwardCandidate[],
  config: WalkForwardConfig
): WalkForwardResult {
  assertPositiveInteger(config.trainingPoints, "trainingPoints");
  assertPositiveInteger(config.testPoints, "testPoints");
  const stepPoints = config.stepPoints ?? config.testPoints;
  assertPositiveInteger(stepPoints, "stepPoints");
  if (stepPoints < config.testPoints) throw new Error("walk forward stepPoints must not overlap test windows");
  if (points.length < config.trainingPoints + config.testPoints) throw new Error("walk forward requires one complete training and test window");
  const orderedCandidates = validateCandidates(candidates);
  const windows: WalkForwardWindow[] = [];
  for (let trainingStart = 0, index = 0; trainingStart + config.trainingPoints + config.testPoints <= points.length; trainingStart += stepPoints, index += 1) {
    const trainingEnd = trainingStart + config.trainingPoints;
    const testEnd = trainingEnd + config.testPoints;
    const trainingPoints = points.slice(trainingStart, trainingEnd);
    const testPoints = points.slice(trainingEnd, testEnd);
    const selected = selectCandidate(trainingPoints, orderedCandidates, config.backtest ?? {});
    const testResult = runBacktest(testPoints, selected.candidate.createStrategy, config.backtest ?? {});
    windows.push(Object.freeze({ index, trainingStart, trainingEnd, testStart: trainingEnd, testEnd, selectedCandidateId: selected.candidate.id, trainingResult: selected.result, testResult }));
  }
  const summary = Object.freeze({
    windows: windows.length,
    outOfSampleReturn: windows.reduce((result, window) => result * (1 + window.testResult.metrics.totalReturn), 1) - 1,
    buyAndHoldReturn: windows.reduce((result, window) => result * (1 + window.testResult.benchmark.buyAndHoldReturn), 1) - 1,
    outperformance: windows.reduce((result, window) => result * (1 + window.testResult.metrics.totalReturn), 1) - windows.reduce((result, window) => result * (1 + window.testResult.benchmark.buyAndHoldReturn), 1),
    selectedCandidates: Object.freeze(windows.map((window) => window.selectedCandidateId))
  });
  return Object.freeze({ windows: Object.freeze(windows), summary });
}

