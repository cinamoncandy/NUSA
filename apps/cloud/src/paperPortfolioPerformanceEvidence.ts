export type PaperPortfolioPerformanceClassification =
  | "VERIFIED_IMPROVEMENT"
  | "NEUTRAL"
  | "REGRESSION"
  | "INSUFFICIENT";

export type PaperPortfolioPerformanceEvidenceStatus =
  | "VERIFIED"
  | "INSUFFICIENT"
  | "UNKNOWN"
  | "CONFLICTING";

export interface PaperPortfolioPerformanceObservation {
  readonly observationId: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly periodStartAt: string;
  readonly periodEndAt: string;
  readonly status: PaperPortfolioPerformanceEvidenceStatus;
  readonly portfolioGrossReturn: number;
  readonly portfolioTurnover: number;
  readonly portfolioFeeRate: number;
  readonly portfolioSlippageRate: number;
  readonly benchmarkNetReturn: number;
  readonly componentNetReturns: readonly number[];
}

export interface PaperPortfolioPerformanceInput {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly evaluatedAt: string;
  readonly minimumEvidencePeriods: number;
  readonly minimumImprovement: number;
  readonly regressionTolerance: number;
  readonly observations: readonly PaperPortfolioPerformanceObservation[];
}

export interface PaperPortfolioPerformanceResult {
  readonly evaluationId: string;
  readonly classification: PaperPortfolioPerformanceClassification;
  readonly periodCount: number;
  readonly portfolioNetReturnMean: number | null;
  readonly benchmarkNetReturnMean: number | null;
  readonly bestComponentNetReturnMean: number | null;
  readonly portfolioVsBenchmark: number | null;
  readonly portfolioVsBestComponent: number | null;
  readonly reasons: readonly string[];
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly evaluatedAt: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const sha256 = /^[a-f0-9]{64}$/i;
const round = (value: number): number => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (!Number.isFinite(rounded)) throw new Error("derived performance value must be finite");
  return rounded;
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const requireRatio = (value: number, label: string): void => {
  requireFinite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};

const mean = (values: readonly number[]): number => round(values.reduce((sum, value) => sum + value, 0) / values.length);

const insufficient = (
  input: PaperPortfolioPerformanceInput,
  reasons: readonly string[],
): PaperPortfolioPerformanceResult => Object.freeze({
  evaluationId: input.evaluationId,
  classification: "INSUFFICIENT",
  periodCount: input.observations.length,
  portfolioNetReturnMean: null,
  benchmarkNetReturnMean: null,
  bestComponentNetReturnMean: null,
  portfolioVsBenchmark: null,
  portfolioVsBestComponent: null,
  reasons: Object.freeze([...reasons].sort()),
  candidateId: input.candidateId,
  datasetId: input.datasetId,
  datasetContentSha256: input.datasetContentSha256,
  evaluatedAt: input.evaluatedAt,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

export function classifyPaperPortfolioPerformance(
  input: PaperPortfolioPerformanceInput,
): PaperPortfolioPerformanceResult {
  if (!input.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!input.candidateId.trim()) throw new Error("candidateId is required");
  if (!input.datasetId.trim()) throw new Error("datasetId is required");
  if (!sha256.test(input.datasetContentSha256)) throw new Error("datasetContentSha256 must be sha256");
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new Error("evaluatedAt must be a valid ISO timestamp");
  if (!Number.isInteger(input.minimumEvidencePeriods) || input.minimumEvidencePeriods <= 0) {
    throw new Error("minimumEvidencePeriods must be a positive integer");
  }
  requireFinite(input.minimumImprovement, "minimumImprovement");
  requireFinite(input.regressionTolerance, "regressionTolerance");
  if (input.minimumImprovement < 0) throw new Error("minimumImprovement must be non-negative");
  if (input.regressionTolerance < 0) throw new Error("regressionTolerance must be non-negative");

  const reasons: string[] = [];
  if (input.observations.length < input.minimumEvidencePeriods) reasons.push("INSUFFICIENT_LONGITUDINAL_EVIDENCE");

  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (!observation.observationId.trim()) throw new Error("observationId is required");
    if (seen.has(observation.observationId)) reasons.push("DUPLICATE_OBSERVATION");
    seen.add(observation.observationId);

    if (
      observation.candidateId !== input.candidateId ||
      observation.datasetId !== input.datasetId ||
      observation.datasetContentSha256 !== input.datasetContentSha256
    ) reasons.push("PROVENANCE_MISMATCH");
    if (observation.status !== "VERIFIED") reasons.push(`EVIDENCE_${observation.status}`);

    const startMs = Date.parse(observation.periodStartAt);
    const endMs = Date.parse(observation.periodEndAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("period timestamps must be valid ISO timestamps");
    if (startMs >= endMs) reasons.push("INVALID_PERIOD_CHRONOLOGY");
    if (endMs > evaluatedAtMs) reasons.push("FUTURE_EVIDENCE");

    requireFinite(observation.portfolioGrossReturn, "portfolioGrossReturn");
    requireRatio(observation.portfolioTurnover, "portfolioTurnover");
    requireRatio(observation.portfolioFeeRate, "portfolioFeeRate");
    requireRatio(observation.portfolioSlippageRate, "portfolioSlippageRate");
    requireFinite(observation.benchmarkNetReturn, "benchmarkNetReturn");
    if (observation.componentNetReturns.length === 0) reasons.push("MISSING_COMPONENT_BENCHMARK");
    for (const componentReturn of observation.componentNetReturns) {
      requireFinite(componentReturn, "componentNetReturn");
    }
  }

  if (reasons.length > 0) return insufficient(input, reasons);

  const portfolioNetReturns = input.observations.map((observation) => round(
    observation.portfolioGrossReturn
      - observation.portfolioTurnover * (observation.portfolioFeeRate + observation.portfolioSlippageRate),
  ));
  const benchmarkNetReturns = input.observations.map((observation) => observation.benchmarkNetReturn);
  const bestComponentNetReturns = input.observations.map((observation) => Math.max(...observation.componentNetReturns));

  const portfolioNetReturnMean = mean(portfolioNetReturns);
  const benchmarkNetReturnMean = mean(benchmarkNetReturns);
  const bestComponentNetReturnMean = mean(bestComponentNetReturns);
  const portfolioVsBenchmark = round(portfolioNetReturnMean - benchmarkNetReturnMean);
  const portfolioVsBestComponent = round(portfolioNetReturnMean - bestComponentNetReturnMean);

  let classification: PaperPortfolioPerformanceClassification = "NEUTRAL";
  if (
    portfolioVsBenchmark >= input.minimumImprovement &&
    portfolioVsBestComponent >= input.minimumImprovement
  ) {
    classification = "VERIFIED_IMPROVEMENT";
  } else if (
    portfolioVsBenchmark < -input.regressionTolerance ||
    portfolioVsBestComponent < -input.regressionTolerance
  ) {
    classification = "REGRESSION";
  }

  const classificationReasons = classification === "VERIFIED_IMPROVEMENT"
    ? ["OUTPERFORMS_BENCHMARK_AFTER_COSTS", "OUTPERFORMS_BEST_COMPONENT_AFTER_COSTS"]
    : classification === "REGRESSION"
      ? ["PORTFOLIO_PERFORMANCE_REGRESSION_REQUIRES_REWORK_OR_ROLLBACK_RECOMMENDATION"]
      : ["NO_VERIFIED_PORTFOLIO_IMPROVEMENT"];

  return Object.freeze({
    evaluationId: input.evaluationId,
    classification,
    periodCount: input.observations.length,
    portfolioNetReturnMean,
    benchmarkNetReturnMean,
    bestComponentNetReturnMean,
    portfolioVsBenchmark,
    portfolioVsBestComponent,
    reasons: Object.freeze(classificationReasons),
    candidateId: input.candidateId,
    datasetId: input.datasetId,
    datasetContentSha256: input.datasetContentSha256,
    evaluatedAt: input.evaluatedAt,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
