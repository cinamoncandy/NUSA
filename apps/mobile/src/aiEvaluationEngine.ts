import {
  runDslBacktest,
  serializeBacktestReport,
  type BacktestDatasetIdentity,
  type BacktestRunInput
} from "./aiBacktestEngine";
import {
  runStrategyOptimization,
  type StrategyOptimizerRunRepository,
  type StrategyOptimizerReport
} from "./aiStrategyOptimizer";

export type RecommendationAction = "BUY" | "SELL" | "HOLD";
export type RecommendationOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";

export interface RecommendationCase {
  readonly caseId: string;
  readonly dataset: BacktestDatasetIdentity;
  readonly expectedAction: RecommendationAction;
  readonly actualAction: RecommendationAction;
  readonly confidence: number;
  readonly outcome: RecommendationOutcome;
}

export interface RecommendationBenchmark {
  readonly totalCases: number;
  readonly evaluatedCases: number;
  readonly accuracy: number;
  readonly successRate: number | null;
  readonly coverage: number;
  readonly averageConfidence: number;
  readonly calibrationError: number | null;
  readonly benchmarkScore: number;
}

export interface BacktestReplayEvidence {
  readonly firstReportId: string;
  readonly secondReportId: string;
  readonly matched: boolean;
  readonly dataset: BacktestDatasetIdentity;
}

export interface OptimizerReplayEvidence {
  readonly firstRunId: string;
  readonly secondRunId: string;
  readonly firstSelectedVersion: string;
  readonly secondSelectedVersion: string;
  readonly firstHoldoutPassed: boolean;
  readonly secondHoldoutPassed: boolean;
  readonly matched: boolean;
  readonly dataset: BacktestDatasetIdentity;
}

export interface AiEvaluationBaseline {
  readonly backtestSerialized: string;
  readonly optimizerSerialized: string;
}

export interface AiEvaluationReport {
  readonly schemaVersion: 1;
  readonly evaluationId: string;
  readonly dataset: BacktestDatasetIdentity;
  readonly backtestReplay: BacktestReplayEvidence;
  readonly optimizerReplay: OptimizerReplayEvidence;
  readonly recommendations: RecommendationBenchmark;
  readonly regression: Readonly<{ status: "PASS" | "FAIL"; backtestMatch: boolean; optimizerMatch: boolean }>;
  readonly gates: Readonly<{
    replayDeterministic: boolean;
    datasetProvenance: boolean;
    safetyBoundary: boolean;
    holdoutPassed: boolean;
    recommendationSample: boolean;
    regressionPassed: boolean;
  }>;
  readonly overallStatus: "PASS" | "FAIL";
  readonly safety: Readonly<{ researchOnly: true; paperOnly: true; liveMutationAllowed: false; mutationAllowed: false }>;
}

export interface AiEvaluationInput {
  readonly dataset: BacktestDatasetIdentity;
  readonly backtest: BacktestRunInput;
  readonly optimizer: StrategyOptimizerReplayInput;
  readonly recommendations: readonly RecommendationCase[];
  readonly config: Readonly<{ minimumEvaluatedRecommendations: number; baseline: AiEvaluationBaseline }>;
}

type StrategyOptimizerInput = Parameters<typeof runStrategyOptimization>[0];
export interface StrategyOptimizerReplayInput {
  readonly input: Omit<StrategyOptimizerInput, "repository">;
  readonly createRepository: () => StrategyOptimizerRunRepository;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const DATASET_CHECKSUM = /^[a-f0-9]{64}$/i;

function validateDataset(dataset: BacktestDatasetIdentity): void {
  if (!dataset.version.trim()) throw new Error("dataset version is required");
  if (!DATASET_CHECKSUM.test(dataset.checksum)) throw new Error("dataset checksum must be SHA-256");
}

function sameDataset(left: BacktestDatasetIdentity, right: BacktestDatasetIdentity): boolean {
  return left.version === right.version && left.checksum === right.checksum;
}

function validateRecommendations(cases: readonly RecommendationCase[], dataset: BacktestDatasetIdentity): void {
  if (cases.length === 0) throw new Error("EVALUATION_RECOMMENDATIONS_REQUIRED");
  const ids = new Set<string>();
  for (const item of cases) {
    if (!item.caseId.trim() || ids.has(item.caseId)) throw new Error("EVALUATION_DUPLICATE_CASE");
    ids.add(item.caseId);
    if (!sameDataset(item.dataset, dataset)) throw new Error("EVALUATION_DATASET_PROVENANCE_MISMATCH");
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error("EVALUATION_CONFIDENCE_INVALID");
  }
}

function average(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

export function evaluateRecommendationBenchmark(cases: readonly RecommendationCase[], dataset: BacktestDatasetIdentity): RecommendationBenchmark {
  validateDataset(dataset);
  validateRecommendations(cases, dataset);
  const exactMatches = cases.filter((item) => item.expectedAction === item.actualAction).length;
  const known = cases.filter((item) => item.outcome !== "UNKNOWN");
  const successful = known.filter((item) => item.outcome === "SUCCESS").length;
  const calibrationErrors = known.map((item) => Math.abs(item.confidence - (item.outcome === "SUCCESS" ? 1 : 0)));
  const accuracy = exactMatches / cases.length;
  const coverage = known.length / cases.length;
  const successRate = known.length ? successful / known.length : null;
  const calibrationError = known.length ? average(calibrationErrors) : null;
  const calibrationScore = calibrationError == null ? 0 : 1 - calibrationError;
  const benchmarkScore = accuracy * 0.5 + (successRate ?? 0) * 0.3 + calibrationScore * 0.2;
  return freeze({ totalCases: cases.length, evaluatedCases: known.length, accuracy, successRate, coverage, averageConfidence: average(cases.map((item) => item.confidence)), calibrationError, benchmarkScore });
}

export function replayBacktestForEvaluation(input: { readonly input: BacktestRunInput }): BacktestReplayEvidence & { readonly serialized: string } {
  const first = runDslBacktest(input.input);
  const second = runDslBacktest(input.input);
  const firstSerialized = serializeBacktestReport(first);
  const secondSerialized = serializeBacktestReport(second);
  return freeze({ firstReportId: first.reportId, secondReportId: second.reportId, matched: firstSerialized === secondSerialized, dataset: freeze({ ...first.dataset }), serialized: firstSerialized });
}

function serializeOptimizerReport(report: StrategyOptimizerReport): string { return JSON.stringify(report); }

export function replayOptimizerForEvaluation(input: StrategyOptimizerReplayInput): OptimizerReplayEvidence & { readonly serialized: string } {
  const firstRepository = input.createRepository();
  const secondRepository = input.createRepository();
  if (firstRepository === secondRepository) throw new Error("OPTIMIZER_REPLAY_REPOSITORY_REUSE");
  const first = runStrategyOptimization({ ...input.input, repository: firstRepository });
  const second = runStrategyOptimization({ ...input.input, repository: secondRepository });
  const firstSerialized = serializeOptimizerReport(first);
  const secondSerialized = serializeOptimizerReport(second);
  return freeze({
    firstRunId: first.runId,
    secondRunId: second.runId,
    firstSelectedVersion: first.selectedCandidate.strategy.version,
    secondSelectedVersion: second.selectedCandidate.strategy.version,
    firstHoldoutPassed: first.holdout.passed,
    secondHoldoutPassed: second.holdout.passed,
    matched: firstSerialized === secondSerialized,
    dataset: freeze({ ...first.dataset }),
    serialized: firstSerialized
  });
}

function safeBacktest(input: BacktestRunInput): boolean {
  return input.strategy.paperOnly === true && input.strategy.productionMutationAllowed === false && input.strategy.executionAllowed === false;
}

export function evaluateAiSystem(input: AiEvaluationInput): AiEvaluationReport {
  validateDataset(input.dataset);
  if (!sameDataset(input.backtest.dataset, input.dataset) || !sameDataset(input.optimizer.input.dataset, input.dataset)) throw new Error("EVALUATION_DATASET_PROVENANCE_MISMATCH");
  if (!Number.isSafeInteger(input.config.minimumEvaluatedRecommendations) || input.config.minimumEvaluatedRecommendations < 1) throw new Error("minimumEvaluatedRecommendations must be positive");
  if (!input.config.baseline.backtestSerialized.trim() || !input.config.baseline.optimizerSerialized.trim()) throw new Error("EVALUATION_BASELINE_REQUIRED");
  const backtestReplay = replayBacktestForEvaluation({ input: input.backtest });
  const optimizerReplay = replayOptimizerForEvaluation(input.optimizer);
  const recommendations = evaluateRecommendationBenchmark(input.recommendations, input.dataset);
  const regression = freeze({
    status: backtestReplay.serialized === input.config.baseline.backtestSerialized && optimizerReplay.serialized === input.config.baseline.optimizerSerialized ? "PASS" as const : "FAIL" as const,
    backtestMatch: backtestReplay.serialized === input.config.baseline.backtestSerialized,
    optimizerMatch: optimizerReplay.serialized === input.config.baseline.optimizerSerialized
  });
  const gates = freeze({
    replayDeterministic: backtestReplay.matched && optimizerReplay.matched,
    datasetProvenance: sameDataset(backtestReplay.dataset, input.dataset) && sameDataset(optimizerReplay.dataset, input.dataset),
    safetyBoundary: safeBacktest(input.backtest) && optimizerReplay.firstHoldoutPassed === true && optimizerReplay.secondHoldoutPassed === true,
    holdoutPassed: optimizerReplay.firstHoldoutPassed && optimizerReplay.secondHoldoutPassed,
    recommendationSample: recommendations.evaluatedCases >= input.config.minimumEvaluatedRecommendations,
    regressionPassed: regression.status === "PASS"
  });
  const overallStatus = Object.values(gates).every(Boolean) ? "PASS" : "FAIL";
  const strategyId = input.backtest.strategy.strategyId;
  const strategyVersion = input.backtest.strategy.version;
  return freeze({
    schemaVersion: 1 as const,
    evaluationId: `ai-evaluation:${strategyId}:${strategyVersion}:${input.dataset.version}`,
    dataset: freeze({ ...input.dataset }),
    backtestReplay: freeze({ firstReportId: backtestReplay.firstReportId, secondReportId: backtestReplay.secondReportId, matched: backtestReplay.matched, dataset: backtestReplay.dataset }),
    optimizerReplay: freeze({ firstRunId: optimizerReplay.firstRunId, secondRunId: optimizerReplay.secondRunId, firstSelectedVersion: optimizerReplay.firstSelectedVersion, secondSelectedVersion: optimizerReplay.secondSelectedVersion, firstHoldoutPassed: optimizerReplay.firstHoldoutPassed, secondHoldoutPassed: optimizerReplay.secondHoldoutPassed, matched: optimizerReplay.matched, dataset: optimizerReplay.dataset }),
    recommendations,
    regression,
    gates,
    overallStatus,
    safety: freeze({ researchOnly: true, paperOnly: true, liveMutationAllowed: false, mutationAllowed: false })
  });
}
