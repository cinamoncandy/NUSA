import type { MarketStateSnapshot } from "./marketStateEngine";

export interface ProbabilityFeatureInput {
  readonly featureId: string;
  readonly featureVersion: number;
  readonly value: number;
  readonly normalizedValue: number;
  readonly weight: number;
  readonly quality: number;
  readonly generatedAt: string;
  readonly provenance: string;
}

export interface CalibrationSample {
  readonly sampleId: string;
  readonly predictedProbability: number;
  readonly outcome: 0 | 1;
  readonly predictedAt: string;
  readonly outcomeAt: string;
}

export interface ProbabilityEngineInput {
  readonly marketState: MarketStateSnapshot;
  readonly features: readonly ProbabilityFeatureInput[];
  readonly calibrationSamples: readonly CalibrationSample[];
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly outcomeDefinition: string;
  readonly minimumCalibrationSamples: number;
  readonly maximumUncertainty: number;
}

export interface ReliabilityBucket {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
  readonly meanPrediction: number;
  readonly observedRate: number;
}

export interface CalibrationMetrics {
  readonly sampleSize: number;
  readonly brierScore: number | null;
  readonly logLoss: number | null;
  readonly expectedCalibrationError: number | null;
  readonly sharpness: number | null;
  readonly reliability: readonly ReliabilityBucket[];
}

export interface ProbabilityEvidence {
  readonly kind: "MARKET_STATE" | "FEATURE" | "CALIBRATION";
  readonly reference: string;
  readonly contribution: number;
}

export interface ProbabilityEstimate {
  readonly market: string;
  readonly outcomeDefinition: string;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly abstain: boolean;
  readonly abstainReasons: readonly string[];
  readonly evidence: readonly ProbabilityEvidence[];
  readonly metrics: CalibrationMetrics;
  readonly modelVersion: string;
  readonly generatedAt: string;
}

const EPSILON = 1e-9;
const BUCKET_COUNT = 10;
const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const validateProbability = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};

const eligibleSamples = (samples: readonly CalibrationSample[], asOf: number): readonly CalibrationSample[] => {
  const ids = new Set<string>();
  return samples.filter((sample) => {
    if (!sample.sampleId.trim()) throw new Error("calibration sampleId is required");
    if (ids.has(sample.sampleId)) throw new Error(`duplicate calibration sample ${sample.sampleId}`);
    ids.add(sample.sampleId);
    validateProbability(sample.predictedProbability, `${sample.sampleId} predictedProbability`);
    const predictedAt = parseTime(sample.predictedAt, `${sample.sampleId} predictedAt`);
    const outcomeAt = parseTime(sample.outcomeAt, `${sample.sampleId} outcomeAt`);
    if (outcomeAt < predictedAt) throw new Error(`${sample.sampleId} outcomeAt cannot precede predictedAt`);
    if (predictedAt > asOf) throw new Error(`${sample.sampleId} prediction cannot be in the future`);
    return outcomeAt <= asOf;
  });
};

const calculateMetrics = (samples: readonly CalibrationSample[]): CalibrationMetrics => {
  if (samples.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      brierScore: null,
      logLoss: null,
      expectedCalibrationError: null,
      sharpness: null,
      reliability: Object.freeze([])
    });
  }

  const buckets: CalibrationSample[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  let brier = 0;
  let logLoss = 0;
  let sharpness = 0;
  for (const sample of samples) {
    const probability = clamp(sample.predictedProbability, EPSILON, 1 - EPSILON);
    brier += (probability - sample.outcome) ** 2;
    logLoss += -(sample.outcome * Math.log(probability) + (1 - sample.outcome) * Math.log(1 - probability));
    sharpness += (probability - 0.5) ** 2;
    buckets[Math.min(BUCKET_COUNT - 1, Math.floor(probability * BUCKET_COUNT))].push(sample);
  }

  let ece = 0;
  const reliability = buckets.map((bucket, index): ReliabilityBucket => {
    const count = bucket.length;
    const meanPrediction = count === 0 ? 0 : bucket.reduce((sum, sample) => sum + sample.predictedProbability, 0) / count;
    const observedRate = count === 0 ? 0 : bucket.reduce((sum, sample) => sum + sample.outcome, 0) / count;
    if (count > 0) ece += (count / samples.length) * Math.abs(meanPrediction - observedRate);
    return Object.freeze({
      lowerBound: index / BUCKET_COUNT,
      upperBound: (index + 1) / BUCKET_COUNT,
      count,
      meanPrediction: round(meanPrediction),
      observedRate: round(observedRate)
    });
  });

  return Object.freeze({
    sampleSize: samples.length,
    brierScore: round(brier / samples.length),
    logLoss: round(logLoss / samples.length),
    expectedCalibrationError: round(ece),
    sharpness: round(sharpness / samples.length),
    reliability: Object.freeze(reliability)
  });
};

const calibrate = (rawProbability: number, samples: readonly CalibrationSample[]): number => {
  const lower = Math.floor(rawProbability * BUCKET_COUNT) / BUCKET_COUNT;
  const upper = lower + 1 / BUCKET_COUNT;
  const bucket = samples.filter((sample) =>
    sample.predictedProbability >= lower
    && (upper >= 1 ? sample.predictedProbability <= 1 : sample.predictedProbability < upper));
  if (bucket.length === 0) return rawProbability;
  const successes = bucket.reduce((sum, sample) => sum + sample.outcome, 0);
  return (successes + 1) / (bucket.length + 2);
};

const freezeEstimate = (estimate: ProbabilityEstimate): ProbabilityEstimate => {
  for (const item of estimate.evidence) Object.freeze(item);
  for (const bucket of estimate.metrics.reliability) Object.freeze(bucket);
  Object.freeze(estimate.evidence);
  Object.freeze(estimate.abstainReasons);
  Object.freeze(estimate.metrics.reliability);
  Object.freeze(estimate.metrics);
  return Object.freeze(estimate);
};

export const estimateProbability = (input: ProbabilityEngineInput): ProbabilityEstimate => {
  if (!input.modelVersion.trim()) throw new Error("modelVersion is required");
  if (!input.outcomeDefinition.trim()) throw new Error("outcomeDefinition is required");
  if (!Number.isInteger(input.minimumCalibrationSamples) || input.minimumCalibrationSamples < 1) {
    throw new Error("minimumCalibrationSamples must be a positive integer");
  }
  validateProbability(input.maximumUncertainty, "maximumUncertainty");
  if (input.features.length === 0) throw new Error("at least one feature is required");

  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  const marketGeneratedAt = parseTime(input.marketState.generatedAt, "marketState.generatedAt");
  if (marketGeneratedAt > generatedAt) throw new Error("market state cannot be generated in the future");

  const featureKeys = new Set<string>();
  let weightedFeatureScore = 0;
  let totalAbsoluteWeight = 0;
  let qualitySum = 0;
  const evidence: ProbabilityEvidence[] = [];

  for (const feature of input.features) {
    const key = `${feature.featureId}@${feature.featureVersion}`;
    if (featureKeys.has(key)) throw new Error(`duplicate probability feature ${key}`);
    featureKeys.add(key);
    if (!feature.featureId.trim() || !Number.isInteger(feature.featureVersion) || feature.featureVersion < 1) {
      throw new Error("feature identity is invalid");
    }
    if (!Number.isFinite(feature.value) || !Number.isFinite(feature.normalizedValue) || !Number.isFinite(feature.weight)) {
      throw new Error(`${key} contains a non-finite value`);
    }
    if (feature.normalizedValue < -1 || feature.normalizedValue > 1) throw new Error(`${key} normalizedValue must be between -1 and 1`);
    validateProbability(feature.quality, `${key} quality`);
    if (!feature.provenance.trim()) throw new Error(`${key} provenance is required`);
    const featureGeneratedAt = parseTime(feature.generatedAt, `${key} generatedAt`);
    if (featureGeneratedAt > generatedAt) throw new Error(`${key} cannot be generated in the future`);
    const contribution = feature.normalizedValue * feature.weight;
    weightedFeatureScore += contribution;
    totalAbsoluteWeight += Math.abs(feature.weight);
    qualitySum += feature.quality;
    evidence.push({ kind: "FEATURE", reference: `${key}:${feature.provenance}`, contribution: round(contribution) });
  }

  const directionalState = input.marketState.regime === "TREND_UP"
    ? input.marketState.trendScore
    : input.marketState.regime === "TREND_DOWN"
      ? -input.marketState.trendScore
      : 0;
  const stateContribution = directionalState * 1.25 - input.marketState.stressScore * 0.5;
  const normalizedFeatureScore = totalAbsoluteWeight === 0 ? 0 : weightedFeatureScore / totalAbsoluteWeight;
  const rawProbability = clamp(sigmoid(stateContribution + normalizedFeatureScore * 2));
  evidence.unshift({ kind: "MARKET_STATE", reference: `${input.marketState.market}:${input.marketState.regime}`, contribution: round(stateContribution) });

  const samples = eligibleSamples(input.calibrationSamples, generatedAt);
  const metrics = calculateMetrics(samples);
  const calibratedProbability = clamp(calibrate(rawProbability, samples));
  evidence.push({ kind: "CALIBRATION", reference: `samples:${samples.length}`, contribution: round(calibratedProbability - rawProbability) });

  const averageQuality = qualitySum / input.features.length;
  const sampleConfidence = Math.min(1, samples.length / input.minimumCalibrationSamples);
  const confidence = clamp(input.marketState.confidence * averageQuality * sampleConfidence);
  const modelDisagreement = Math.abs(calibratedProbability - rawProbability);
  const uncertainty = clamp(Math.max(input.marketState.uncertaintyScore, 1 - confidence, modelDisagreement));
  const abstainReasons: string[] = [];
  if (samples.length < input.minimumCalibrationSamples) abstainReasons.push("INSUFFICIENT_CALIBRATION_SAMPLES");
  if (uncertainty > input.maximumUncertainty) abstainReasons.push("UNCERTAINTY_LIMIT_EXCEEDED");
  if (input.marketState.regime === "LIQUIDITY_STRESS") abstainReasons.push("LIQUIDITY_STRESS");

  return freezeEstimate({
    market: input.marketState.market,
    outcomeDefinition: input.outcomeDefinition,
    rawProbability: round(rawProbability),
    calibratedProbability: round(calibratedProbability),
    confidence: round(confidence),
    uncertainty: round(uncertainty),
    abstain: abstainReasons.length > 0,
    abstainReasons: Object.freeze(abstainReasons),
    evidence: Object.freeze(evidence),
    metrics,
    modelVersion: input.modelVersion,
    generatedAt: input.generatedAt
  });
};
