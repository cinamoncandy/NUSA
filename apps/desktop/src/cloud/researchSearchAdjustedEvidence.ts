import { verifyResearchTrialLedger, type ResearchTrialRecord } from "./researchTrialLedger";

export class ResearchStatisticalEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchStatisticalEvidenceError";
  }
}

export interface DeflatedSharpeInput {
  readonly ledger: readonly ResearchTrialRecord[];
  readonly searchId: string;
  readonly selectedTrialId: string;
  readonly sampleLength: number;
  readonly skewness: number;
  readonly kurtosis: number;
  readonly confidenceThreshold?: number;
  readonly sharpeMetricKey?: string;
}

export interface DeflatedSharpeEvidence {
  readonly searchId: string;
  readonly selectedTrialId: string;
  readonly observedSharpe: number;
  readonly searchTrialCount: number;
  readonly completedSharpeTrialCount: number;
  readonly trialSharpeStdDev: number;
  readonly expectedMaximumSharpe: number;
  readonly zScore: number;
  readonly deflatedSharpeProbability: number;
  readonly confidenceThreshold: number;
  readonly passes: boolean;
}

export interface PboStrategyReturns {
  readonly strategyId: string;
  readonly returns: readonly number[];
}

export interface PboCscvInput {
  readonly strategies: readonly PboStrategyReturns[];
  readonly partitions?: number;
}

export interface PboCscvSplit {
  readonly inSamplePartitions: readonly number[];
  readonly selectedStrategyId: string;
  readonly selectedInSampleSharpe: number;
  readonly selectedOutOfSampleSharpe: number;
  readonly outOfSampleRelativeRank: number;
  readonly logit: number;
  readonly overfit: boolean;
}

export interface PboCscvEvidence {
  readonly strategyCount: number;
  readonly observationCount: number;
  readonly partitions: number;
  readonly splitCount: number;
  readonly overfitSplitCount: number;
  readonly probabilityBacktestOverfitting: number;
  readonly medianLogit: number;
  readonly splits: readonly PboCscvSplit[];
}

const EULER_MASCHERONI = 0.5772156649015329;
const DEFAULT_DSR_CONFIDENCE = 0.95;
const DEFAULT_PBO_PARTITIONS = 8;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new ResearchStatisticalEvidenceError("NON_FINITE_VALUE", `${name} must be finite`);
}

function assertProbability(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0 || value >= 1) throw new ResearchStatisticalEvidenceError("INVALID_PROBABILITY", `${name} must be strictly between 0 and 1`);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) throw new ResearchStatisticalEvidenceError("INSUFFICIENT_SAMPLE", "at least two values are required to estimate sample dispersion");
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

// Abramowitz-Stegun 7.1.26 approximation. Maximum absolute error is about 1.5e-7.
function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

// Peter J. Acklam's inverse-normal rational approximation.
function inverseNormalCdf(probability: number): number {
  assertProbability(probability, "normal quantile probability");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function expectedMaximumSharpe(sharpes: readonly number[], trialCount: number): { readonly stdDev: number; readonly hurdle: number } {
  if (!Number.isInteger(trialCount) || trialCount < 2) {
    throw new ResearchStatisticalEvidenceError("INSUFFICIENT_SEARCH_TRIALS", "DSR requires at least two recorded search trials");
  }
  const stdDev = sampleStdDev(sharpes);
  if (stdDev === 0) return { stdDev, hurdle: 0 };
  const first = inverseNormalCdf(1 - 1 / trialCount);
  const second = inverseNormalCdf(1 - 1 / (trialCount * Math.E));
  return { stdDev, hurdle: stdDev * ((1 - EULER_MASCHERONI) * first + EULER_MASCHERONI * second) };
}

function metricNumber(record: ResearchTrialRecord, key: string): number | undefined {
  const value = record.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function calculateDeflatedSharpeEvidence(input: DeflatedSharpeInput): DeflatedSharpeEvidence {
  verifyResearchTrialLedger(input.ledger);
  const searchId = input.searchId.trim();
  const selectedTrialId = input.selectedTrialId.trim();
  if (!searchId || !selectedTrialId) throw new ResearchStatisticalEvidenceError("EMPTY_IDENTIFIER", "searchId and selectedTrialId are required");
  if (!Number.isInteger(input.sampleLength) || input.sampleLength < 2) throw new ResearchStatisticalEvidenceError("INVALID_SAMPLE_LENGTH", "sampleLength must be an integer of at least two observations");
  assertFinite(input.skewness, "skewness");
  assertFinite(input.kurtosis, "kurtosis");
  if (input.kurtosis < 1) throw new ResearchStatisticalEvidenceError("INVALID_KURTOSIS", "kurtosis must be at least one");
  const confidenceThreshold = input.confidenceThreshold ?? DEFAULT_DSR_CONFIDENCE;
  assertProbability(confidenceThreshold, "confidenceThreshold");
  const metricKey = input.sharpeMetricKey?.trim() || "sharpeRatio";

  const searchRecords = input.ledger.filter((record) => record.search.searchId === searchId);
  if (searchRecords.length < 2) throw new ResearchStatisticalEvidenceError("INSUFFICIENT_SEARCH_TRIALS", `search ${searchId} requires at least two recorded trials`);
  const selected = searchRecords.find((record) => record.trialId === selectedTrialId);
  if (selected == null) throw new ResearchStatisticalEvidenceError("SELECTED_TRIAL_NOT_IN_SEARCH", `selected trial ${selectedTrialId} is not part of search ${searchId}`);
  if (selected.outcome !== "COMPLETED") throw new ResearchStatisticalEvidenceError("SELECTED_TRIAL_NOT_COMPLETED", "selected trial must be completed");
  const observedSharpe = metricNumber(selected, metricKey);
  if (observedSharpe == null) throw new ResearchStatisticalEvidenceError("SELECTED_SHARPE_MISSING", `selected trial requires finite metrics.${metricKey}`);

  const completedSharpes = searchRecords
    .filter((record) => record.outcome === "COMPLETED")
    .map((record) => metricNumber(record, metricKey))
    .filter((value): value is number => value != null);
  if (completedSharpes.length < 2) {
    throw new ResearchStatisticalEvidenceError("INSUFFICIENT_SHARPE_TRIALS", "at least two completed trials with finite Sharpe metrics are required to estimate search dispersion");
  }

  const expected = expectedMaximumSharpe(completedSharpes, searchRecords.length);
  const varianceCorrection = 1 - input.skewness * observedSharpe + ((input.kurtosis - 1) / 4) * observedSharpe ** 2;
  if (!(varianceCorrection > 0) || !Number.isFinite(varianceCorrection)) {
    throw new ResearchStatisticalEvidenceError("INVALID_SHARPE_VARIANCE_CORRECTION", "Sharpe skew/kurtosis variance correction must be finite and positive");
  }
  const zScore = (observedSharpe - expected.hurdle) * Math.sqrt(input.sampleLength - 1) / Math.sqrt(varianceCorrection);
  const probability = normalCdf(zScore);
  return freeze({
    searchId,
    selectedTrialId,
    observedSharpe,
    searchTrialCount: searchRecords.length,
    completedSharpeTrialCount: completedSharpes.length,
    trialSharpeStdDev: expected.stdDev,
    expectedMaximumSharpe: expected.hurdle,
    zScore,
    deflatedSharpeProbability: probability,
    confidenceThreshold,
    passes: probability >= confidenceThreshold
  });
}

function sharpeRatio(values: readonly number[]): number {
  if (values.length < 2) throw new ResearchStatisticalEvidenceError("INSUFFICIENT_RETURN_POINTS", "Sharpe evaluation requires at least two return observations");
  values.forEach((value) => assertFinite(value, "return"));
  const average = mean(values);
  const deviation = sampleStdDev(values);
  if (deviation === 0) throw new ResearchStatisticalEvidenceError("ZERO_RETURN_VARIANCE", "CSCV cannot rank a strategy on a zero-variance return slice");
  return average / deviation;
}

function combinations(count: number, choose: number): readonly (readonly number[])[] {
  const output: number[][] = [];
  const current: number[] = [];
  const visit = (start: number): void => {
    if (current.length === choose) {
      output.push([...current]);
      return;
    }
    const remaining = choose - current.length;
    for (let index = start; index <= count - remaining; index += 1) {
      current.push(index);
      visit(index + 1);
      current.pop();
    }
  };
  visit(0);
  return Object.freeze(output.map((entry) => Object.freeze(entry)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function estimateProbabilityBacktestOverfitting(input: PboCscvInput): PboCscvEvidence {
  const strategies = input.strategies;
  if (strategies.length < 2) throw new ResearchStatisticalEvidenceError("INSUFFICIENT_STRATEGIES", "PBO requires at least two strategy return series");
  const ids = strategies.map((strategy) => strategy.strategyId.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new ResearchStatisticalEvidenceError("INVALID_STRATEGY_IDS", "strategyId values must be unique and non-empty");
  const observationCount = strategies[0]!.returns.length;
  if (observationCount < 8) throw new ResearchStatisticalEvidenceError("INSUFFICIENT_RETURN_POINTS", "PBO requires at least eight observations per strategy");
  if (strategies.some((strategy) => strategy.returns.length !== observationCount)) throw new ResearchStatisticalEvidenceError("UNEQUAL_RETURN_LENGTHS", "all PBO strategy return series must have equal length");
  for (const strategy of strategies) strategy.returns.forEach((value) => assertFinite(value, `returns for ${strategy.strategyId}`));

  const partitions = input.partitions ?? DEFAULT_PBO_PARTITIONS;
  if (!Number.isInteger(partitions) || partitions < 4 || partitions > 16 || partitions % 2 !== 0) {
    throw new ResearchStatisticalEvidenceError("INVALID_PARTITIONS", "partitions must be an even integer between 4 and 16");
  }
  if (observationCount % partitions !== 0) throw new ResearchStatisticalEvidenceError("UNEQUAL_PARTITIONS", "observation count must be divisible by partitions for symmetric CSCV");
  const segmentLength = observationCount / partitions;
  if (segmentLength < 2) throw new ResearchStatisticalEvidenceError("PARTITION_TOO_SHORT", "each CSCV partition must contain at least two observations");

  const partitionSets = combinations(partitions, partitions / 2);
  const splits: PboCscvSplit[] = [];
  for (const inSamplePartitions of partitionSets) {
    const inSet = new Set(inSamplePartitions);
    const inIndices: number[] = [];
    const outIndices: number[] = [];
    for (let partition = 0; partition < partitions; partition += 1) {
      const target = inSet.has(partition) ? inIndices : outIndices;
      for (let offset = 0; offset < segmentLength; offset += 1) target.push(partition * segmentLength + offset);
    }
    const scored = strategies.map((strategy, index) => ({
      strategyId: ids[index]!,
      inSampleSharpe: sharpeRatio(inIndices.map((point) => strategy.returns[point]!)),
      outOfSampleSharpe: sharpeRatio(outIndices.map((point) => strategy.returns[point]!))
    }));
    const selected = [...scored].sort((left, right) => right.inSampleSharpe - left.inSampleSharpe || left.strategyId.localeCompare(right.strategyId))[0]!;
    const less = scored.filter((score) => score.outOfSampleSharpe < selected.outOfSampleSharpe).length;
    const equal = scored.filter((score) => score.outOfSampleSharpe === selected.outOfSampleSharpe).length;
    const averageRankFromWorst = less + (equal + 1) / 2;
    const relativeRank = averageRankFromWorst / (strategies.length + 1);
    const logit = Math.log(relativeRank / (1 - relativeRank));
    splits.push(freeze({
      inSamplePartitions: Object.freeze([...inSamplePartitions]),
      selectedStrategyId: selected.strategyId,
      selectedInSampleSharpe: selected.inSampleSharpe,
      selectedOutOfSampleSharpe: selected.outOfSampleSharpe,
      outOfSampleRelativeRank: relativeRank,
      logit,
      overfit: logit <= 0
    }));
  }
  const overfitSplitCount = splits.filter((split) => split.overfit).length;
  return freeze({
    strategyCount: strategies.length,
    observationCount,
    partitions,
    splitCount: splits.length,
    overfitSplitCount,
    probabilityBacktestOverfitting: overfitSplitCount / splits.length,
    medianLogit: median(splits.map((split) => split.logit)),
    splits: Object.freeze(splits)
  });
}
