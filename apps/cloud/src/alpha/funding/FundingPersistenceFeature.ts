export interface FundingMarketSample {
  readonly sampleId: string;
  readonly market: string;
  readonly closeTime: string;
  readonly fundingRate: number;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly openInterest: number;
  readonly volume: number;
}

export interface FundingPersistenceFeaturePolicy {
  readonly featureVersion: number;
  readonly lookbackSamples: number;
  readonly extremeZScore: number;
  readonly maximumGapMs: number;
  readonly minimumIndexPrice: number;
}

export interface FundingPersistenceFeatureVector {
  readonly featureId: "FUNDING_PERSISTENCE";
  readonly featureVersion: number;
  readonly market: string;
  readonly generatedAt: string;
  readonly sourceStartAt: string;
  readonly sourceEndAt: string;
  readonly sampleCount: number;
  readonly fundingRate: number;
  readonly fundingMean: number;
  readonly fundingStdDev: number;
  readonly fundingZScore: number;
  readonly fundingVelocity: number;
  readonly fundingAcceleration: number;
  readonly persistenceSamples: number;
  readonly persistenceRatio: number;
  readonly openInterestDelta: number;
  readonly volumeDelta: number;
  readonly basisRate: number;
  readonly fundingOpenInterestInteraction: number;
  readonly fundingVolumeInteraction: number;
  readonly direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  readonly quality: number;
  readonly warnings: readonly string[];
  readonly provenance: readonly string[];
}

const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const validatePolicy = (policy: FundingPersistenceFeaturePolicy): void => {
  if (!Number.isInteger(policy.featureVersion) || policy.featureVersion < 1) throw new Error("featureVersion must be a positive integer");
  if (!Number.isInteger(policy.lookbackSamples) || policy.lookbackSamples < 3) throw new Error("lookbackSamples must be at least 3");
  requireFinite(policy.extremeZScore, "extremeZScore");
  if (policy.extremeZScore <= 0) throw new Error("extremeZScore must be positive");
  requireFinite(policy.maximumGapMs, "maximumGapMs");
  if (policy.maximumGapMs <= 0) throw new Error("maximumGapMs must be positive");
  requireFinite(policy.minimumIndexPrice, "minimumIndexPrice");
  if (policy.minimumIndexPrice <= 0) throw new Error("minimumIndexPrice must be positive");
};

const validateSample = (sample: FundingMarketSample, expectedMarket: string): number => {
  if (!sample.sampleId.trim()) throw new Error("sampleId is required");
  if (!sample.market.trim()) throw new Error(`${sample.sampleId} market is required`);
  if (sample.market !== expectedMarket) throw new Error(`${sample.sampleId} market does not match ${expectedMarket}`);
  const timestamp = parseTime(sample.closeTime, `${sample.sampleId}.closeTime`);
  requireFinite(sample.fundingRate, `${sample.sampleId}.fundingRate`);
  requireFinite(sample.markPrice, `${sample.sampleId}.markPrice`);
  requireFinite(sample.indexPrice, `${sample.sampleId}.indexPrice`);
  requireFinite(sample.openInterest, `${sample.sampleId}.openInterest`);
  requireFinite(sample.volume, `${sample.sampleId}.volume`);
  if (sample.markPrice <= 0 || sample.indexPrice <= 0) throw new Error(`${sample.sampleId} prices must be positive`);
  if (sample.openInterest < 0 || sample.volume < 0) throw new Error(`${sample.sampleId} openInterest and volume must be non-negative`);
  return timestamp;
};

const relativeChange = (previous: number, current: number): number => {
  if (previous === 0) return current === 0 ? 0 : Math.sign(current);
  return (current - previous) / Math.abs(previous);
};

const freezeVector = (vector: FundingPersistenceFeatureVector): FundingPersistenceFeatureVector => {
  Object.freeze(vector.warnings);
  Object.freeze(vector.provenance);
  return Object.freeze(vector);
};

export const calculateFundingPersistenceFeature = (
  samples: readonly FundingMarketSample[],
  generatedAt: string,
  policy: FundingPersistenceFeaturePolicy
): FundingPersistenceFeatureVector => {
  validatePolicy(policy);
  const generatedTimestamp = parseTime(generatedAt, "generatedAt");
  if (samples.length < policy.lookbackSamples) throw new Error(`at least ${policy.lookbackSamples} samples are required`);

  const window = samples.slice(samples.length - policy.lookbackSamples);
  const market = window[0]?.market ?? "";
  if (!market.trim()) throw new Error("market is required");

  const ids = new Set<string>();
  const timestamps: number[] = [];
  for (const sample of window) {
    if (ids.has(sample.sampleId)) throw new Error(`duplicate sample ${sample.sampleId}`);
    ids.add(sample.sampleId);
    timestamps.push(validateSample(sample, market));
  }

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    if (timestamp === undefined) throw new Error("timestamp invariant violated");
    if (timestamp > generatedTimestamp) throw new Error("source sample cannot be in the future");
    if (index === 0) continue;
    const previous = timestamps[index - 1];
    if (previous === undefined || timestamp <= previous) throw new Error("samples must be strictly chronological");
    if (timestamp - previous > policy.maximumGapMs) throw new Error("sample gap exceeds maximumGapMs");
  }

  const rates = window.map((sample) => sample.fundingRate);
  const mean = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const variance = rates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rates.length;
  const standardDeviation = Math.sqrt(variance);
  const latest = window[window.length - 1];
  const previous = window[window.length - 2];
  const previousPrevious = window[window.length - 3];
  if (!latest || !previous || !previousPrevious) throw new Error("feature window invariant violated");
  if (latest.indexPrice < policy.minimumIndexPrice) throw new Error("latest index price is below minimumIndexPrice");

  const zScore = standardDeviation === 0 ? 0 : (latest.fundingRate - mean) / standardDeviation;
  const previousVelocity = previous.fundingRate - previousPrevious.fundingRate;
  const velocity = latest.fundingRate - previous.fundingRate;
  const acceleration = velocity - previousVelocity;
  const extremeDirection = zScore >= policy.extremeZScore ? 1 : zScore <= -policy.extremeZScore ? -1 : 0;

  let persistenceSamples = 0;
  if (extremeDirection !== 0) {
    for (let index = window.length - 1; index >= 0; index -= 1) {
      const sample = window[index];
      if (!sample) break;
      const sampleZ = standardDeviation === 0 ? 0 : (sample.fundingRate - mean) / standardDeviation;
      const sameDirection = extremeDirection > 0 ? sampleZ >= policy.extremeZScore : sampleZ <= -policy.extremeZScore;
      if (!sameDirection) break;
      persistenceSamples += 1;
    }
  }

  const openInterestDelta = relativeChange(previous.openInterest, latest.openInterest);
  const volumeDelta = relativeChange(previous.volume, latest.volume);
  const basisRate = (latest.markPrice - latest.indexPrice) / latest.indexPrice;
  const fundingOpenInterestInteraction = latest.fundingRate * openInterestDelta;
  const fundingVolumeInteraction = latest.fundingRate * volumeDelta;
  const warnings: string[] = [];
  if (standardDeviation === 0) warnings.push("ZERO_FUNDING_VARIANCE");
  if (latest.openInterest === 0) warnings.push("ZERO_OPEN_INTEREST");
  if (latest.volume === 0) warnings.push("ZERO_VOLUME");

  const completeness = window.length / policy.lookbackSamples;
  const varianceQuality = standardDeviation === 0 ? 0.5 : 1;
  const marketQuality = latest.openInterest > 0 && latest.volume > 0 ? 1 : 0.7;
  const quality = clamp01(completeness * varianceQuality * marketQuality);
  const direction = extremeDirection > 0 ? "POSITIVE" : extremeDirection < 0 ? "NEGATIVE" : "NEUTRAL";

  return freezeVector({
    featureId: "FUNDING_PERSISTENCE",
    featureVersion: policy.featureVersion,
    market,
    generatedAt,
    sourceStartAt: window[0]?.closeTime ?? generatedAt,
    sourceEndAt: latest.closeTime,
    sampleCount: window.length,
    fundingRate: round(latest.fundingRate),
    fundingMean: round(mean),
    fundingStdDev: round(standardDeviation),
    fundingZScore: round(zScore),
    fundingVelocity: round(velocity),
    fundingAcceleration: round(acceleration),
    persistenceSamples,
    persistenceRatio: round(persistenceSamples / policy.lookbackSamples),
    openInterestDelta: round(openInterestDelta),
    volumeDelta: round(volumeDelta),
    basisRate: round(basisRate),
    fundingOpenInterestInteraction: round(fundingOpenInterestInteraction),
    fundingVolumeInteraction: round(fundingVolumeInteraction),
    direction,
    quality: round(quality),
    warnings: Object.freeze(warnings),
    provenance: Object.freeze(window.map((sample) => sample.sampleId))
  });
};
