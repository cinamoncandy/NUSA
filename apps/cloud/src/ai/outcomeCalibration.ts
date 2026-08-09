import {
  aiSha256,
  isAiSha256,
  type AiCalibrationCohortKey,
  type AiCalibrationOutcome,
  type AiCalibrationPrediction,
  type AiCalibrationProfile,
  type AiCalibrationReliabilityBucket
} from "../../../../packages/contracts/src/aiInference";

export interface CalibrationSample {
  readonly probability: number;
  readonly outcome: boolean;
}

export interface CalibrationMetrics {
  readonly sampleCount: number;
  readonly expectedCalibrationError: number;
  readonly brierScore: number;
  readonly reliabilityBuckets: readonly AiCalibrationReliabilityBucket[];
}

export interface CalibrationPolicy {
  readonly minimumSamples?: number;
  readonly minimumBucketSamples?: number;
  readonly bucketCount?: number;
  readonly maximumExpectedCalibrationError?: number;
  readonly maximumBrierScore?: number;
}

type PredictionInput = Omit<AiCalibrationPrediction, "contentHash">;
type OutcomeInput = Omit<AiCalibrationOutcome, "contentHash">;

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

const sha256 = (value: string, field: string): string => {
  if (!isAiSha256(value)) throw new Error(`${field} must be sha256`);
  return value.toLowerCase();
};

const finiteNumber = (value: number, field: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
};

const probability = (value: number, field = "probability"): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be finite and within [0,1]`);
  return value;
};

const positiveInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const timestamp = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const normalizeCohort = (cohort: AiCalibrationCohortKey): AiCalibrationCohortKey => Object.freeze({
  providerId: text(cohort.providerId, "providerId"),
  modelVersionId: text(cohort.modelVersionId, "modelVersionId"),
  promptArtifactId: text(cohort.promptArtifactId, "promptArtifactId"),
  promptArtifactVersion: text(cohort.promptArtifactVersion, "promptArtifactVersion"),
  promptArtifactDigest: sha256(cohort.promptArtifactDigest, "promptArtifactDigest"),
  outcomeDefinitionId: text(cohort.outcomeDefinitionId, "outcomeDefinitionId"),
  outcomeDefinitionVersion: text(cohort.outcomeDefinitionVersion, "outcomeDefinitionVersion")
});

const predictionIdentity = (prediction: PredictionInput): Readonly<Record<string, unknown>> => {
  const predictedAt = timestamp(prediction.predictedAt, "predictedAt");
  const anchorObservedAt = timestamp(prediction.anchorObservedAt, "anchorObservedAt");
  if (anchorObservedAt > predictedAt) throw new Error("calibration anchor cannot postdate prediction");
  return {
    predictionId: text(prediction.predictionId, "predictionId"),
    orchestrationRunId: text(prediction.orchestrationRunId, "orchestrationRunId"),
    proposalId: text(prediction.proposalId, "proposalId"),
    agentId: text(prediction.agentId, "agentId"),
    role: prediction.role,
    ...normalizeCohort(prediction),
    targetId: text(prediction.targetId, "targetId"),
    anchorValue: finiteNumber(prediction.anchorValue, "anchorValue"),
    anchorObservedAt,
    anchorEvidenceReference: text(prediction.anchorEvidenceReference, "anchorEvidenceReference"),
    rawProbability: probability(prediction.rawProbability, "rawProbability"),
    predictedAt,
    horizonMs: positiveInteger(prediction.horizonMs, "horizonMs"),
    provenance: prediction.provenance
  };
};

const outcomeIdentity = (outcome: OutcomeInput): Readonly<Record<string, unknown>> => {
  const evidenceReferences = Object.freeze([...new Set(outcome.evidenceReferences.map((item) => text(item, "evidenceReference")))].sort());
  if (evidenceReferences.length === 0) throw new Error("outcome evidenceReferences are required");
  if (typeof outcome.outcome !== "boolean") throw new Error("calibration outcome must be boolean");
  return {
    predictionId: text(outcome.predictionId, "predictionId"),
    predictionContentHash: sha256(outcome.predictionContentHash, "predictionContentHash"),
    outcomeDefinitionId: text(outcome.outcomeDefinitionId, "outcomeDefinitionId"),
    outcomeDefinitionVersion: text(outcome.outcomeDefinitionVersion, "outcomeDefinitionVersion"),
    outcome: outcome.outcome,
    resolvedValue: finiteNumber(outcome.resolvedValue, "resolvedValue"),
    resolvedAt: timestamp(outcome.resolvedAt, "resolvedAt"),
    evidenceReferences,
    provenance: outcome.provenance
  };
};

export function createCalibrationPrediction(input: PredictionInput): AiCalibrationPrediction {
  const identity = predictionIdentity(input);
  return Object.freeze({ ...(identity as unknown as PredictionInput), contentHash: aiSha256(identity) });
}

export function createCalibrationOutcome(input: OutcomeInput): AiCalibrationOutcome {
  const identity = outcomeIdentity(input);
  return Object.freeze({ ...(identity as unknown as OutcomeInput), contentHash: aiSha256(identity) });
}

export function verifyCalibrationPrediction(prediction: AiCalibrationPrediction): boolean {
  if (!isAiSha256(prediction.contentHash)) return false;
  try { return aiSha256(predictionIdentity(prediction)) === prediction.contentHash.toLowerCase(); }
  catch { return false; }
}

export function verifyCalibrationOutcome(outcome: AiCalibrationOutcome): boolean {
  if (!isAiSha256(outcome.contentHash)) return false;
  try { return aiSha256(outcomeIdentity(outcome)) === outcome.contentHash.toLowerCase(); }
  catch { return false; }
}

export function computeCalibrationMetrics(samples: readonly CalibrationSample[], bucketCount = 10): CalibrationMetrics {
  positiveInteger(bucketCount, "bucketCount");
  if (bucketCount > 100) throw new Error("bucketCount is too large");
  if (samples.length === 0) return Object.freeze({ sampleCount: 0, expectedCalibrationError: 0, brierScore: 0, reliabilityBuckets: Object.freeze(Array.from({ length: bucketCount }, (_, index) => emptyBucket(index, bucketCount))) });
  const normalized = samples.map((sample) => {
    if (typeof sample.outcome !== "boolean") throw new Error("calibration sample outcome must be boolean");
    return Object.freeze({ probability: probability(sample.probability), outcome: sample.outcome });
  });
  const grouped = Array.from({ length: bucketCount }, () => [] as CalibrationSample[]);
  for (const sample of normalized) grouped[Math.min(bucketCount - 1, Math.floor(sample.probability * bucketCount))]!.push(sample);
  const reliabilityBuckets = Object.freeze(grouped.map((bucket, index) => {
    if (bucket.length === 0) return emptyBucket(index, bucketCount);
    const meanPredicted = bucket.reduce((sum, sample) => sum + sample.probability, 0) / bucket.length;
    const observedRate = bucket.reduce((sum, sample) => sum + (sample.outcome ? 1 : 0), 0) / bucket.length;
    return Object.freeze({ lowerBound: index / bucketCount, upperBound: (index + 1) / bucketCount, count: bucket.length, meanPredicted, observedRate, absoluteGap: Math.abs(meanPredicted - observedRate) });
  }));
  const expectedCalibrationError = reliabilityBuckets.reduce((sum, bucket) => sum + (bucket.absoluteGap ?? 0) * bucket.count / normalized.length, 0);
  const brierScore = normalized.reduce((sum, sample) => sum + (sample.probability - (sample.outcome ? 1 : 0)) ** 2, 0) / normalized.length;
  return Object.freeze({ sampleCount: normalized.length, expectedCalibrationError, brierScore, reliabilityBuckets });
}

const emptyBucket = (index: number, count: number): AiCalibrationReliabilityBucket => Object.freeze({ lowerBound: index / count, upperBound: (index + 1) / count, count: 0, meanPredicted: null, observedRate: null, absoluteGap: null });

const sameCohort = (prediction: AiCalibrationPrediction, cohort: AiCalibrationCohortKey): boolean => {
  const normalized = normalizeCohort(cohort);
  return prediction.providerId === normalized.providerId
    && prediction.modelVersionId === normalized.modelVersionId
    && prediction.promptArtifactId === normalized.promptArtifactId
    && prediction.promptArtifactVersion === normalized.promptArtifactVersion
    && prediction.promptArtifactDigest === normalized.promptArtifactDigest
    && prediction.outcomeDefinitionId === normalized.outcomeDefinitionId
    && prediction.outcomeDefinitionVersion === normalized.outcomeDefinitionVersion;
};

const sameHash = (left: { readonly contentHash: string }, right: { readonly contentHash: string }): boolean => left.contentHash.toLowerCase() === right.contentHash.toLowerCase();

export class OutcomeCalibrationLedger {
  private readonly predictions = new Map<string, AiCalibrationPrediction>();
  private readonly outcomes = new Map<string, AiCalibrationOutcome>();

  public appendPrediction(prediction: AiCalibrationPrediction): AiCalibrationPrediction {
    if (!verifyCalibrationPrediction(prediction)) throw new Error("calibration prediction hash mismatch");
    const prior = this.predictions.get(prediction.predictionId);
    if (prior != null) {
      if (!sameHash(prior, prediction)) throw new Error("conflicting calibration prediction replay");
      return prior;
    }
    this.predictions.set(prediction.predictionId, prediction);
    return prediction;
  }

  public appendOutcome(outcome: AiCalibrationOutcome): AiCalibrationOutcome {
    if (!verifyCalibrationOutcome(outcome)) throw new Error("calibration outcome hash mismatch");
    const prediction = this.predictions.get(outcome.predictionId);
    if (prediction == null) throw new Error("calibration prediction is missing");
    if (outcome.predictionContentHash.toLowerCase() !== prediction.contentHash.toLowerCase()) throw new Error("calibration outcome prediction hash mismatch");
    if (prediction.outcomeDefinitionId !== outcome.outcomeDefinitionId || prediction.outcomeDefinitionVersion !== outcome.outcomeDefinitionVersion) throw new Error("calibration outcome identity mismatch");
    if (prediction.provenance !== outcome.provenance) throw new Error("calibration provenance mismatch");
    if (outcome.resolvedAt < prediction.predictedAt + prediction.horizonMs) throw new Error("calibration outcome resolved before horizon");
    const prior = this.outcomes.get(outcome.predictionId);
    if (prior != null) {
      if (!sameHash(prior, outcome)) throw new Error("conflicting calibration outcome replay");
      return prior;
    }
    this.outcomes.set(outcome.predictionId, outcome);
    return outcome;
  }

  public profile(cohort: AiCalibrationCohortKey, rawProbability: number, policy: CalibrationPolicy = {}): AiCalibrationProfile {
    const normalizedCohort = normalizeCohort(cohort);
    const raw = probability(rawProbability, "rawProbability");
    const minimumSamples = policy.minimumSamples ?? 20;
    const minimumBucketSamples = policy.minimumBucketSamples ?? 5;
    const bucketCount = policy.bucketCount ?? 10;
    const maximumExpectedCalibrationError = probability(policy.maximumExpectedCalibrationError ?? 0.15, "maximumExpectedCalibrationError");
    const maximumBrierScore = probability(policy.maximumBrierScore ?? 0.25, "maximumBrierScore");
    positiveInteger(minimumSamples, "minimumSamples");
    positiveInteger(minimumBucketSamples, "minimumBucketSamples");
    const samples: CalibrationSample[] = [];
    for (const prediction of this.predictions.values()) {
      if (prediction.provenance !== "VERIFIED_RUNTIME" || !sameCohort(prediction, normalizedCohort)) continue;
      const outcome = this.outcomes.get(prediction.predictionId);
      if (outcome == null || outcome.provenance !== "VERIFIED_RUNTIME") continue;
      samples.push(Object.freeze({ probability: prediction.rawProbability, outcome: outcome.outcome }));
    }
    const metrics = computeCalibrationMetrics(samples, bucketCount);
    const bucket = metrics.reliabilityBuckets[Math.min(bucketCount - 1, Math.floor(raw * bucketCount))];
    let status: AiCalibrationProfile["status"] = "INSUFFICIENT_DATA";
    if (metrics.sampleCount >= minimumSamples) {
      if (metrics.expectedCalibrationError > maximumExpectedCalibrationError || metrics.brierScore > maximumBrierScore) status = "DEGRADED";
      else if ((bucket?.count ?? 0) >= minimumBucketSamples) status = "CALIBRATED";
    }
    const calibratedProbability = status === "CALIBRATED" ? bucket?.observedRate ?? null : null;
    const effectiveConfidence = calibratedProbability == null ? 0 : Math.min(raw, calibratedProbability);
    return Object.freeze({ cohort: normalizedCohort, status, sampleCount: metrics.sampleCount, expectedCalibrationError: metrics.sampleCount === 0 ? null : metrics.expectedCalibrationError, brierScore: metrics.sampleCount === 0 ? null : metrics.brierScore, rawProbability: raw, calibratedProbability, effectiveConfidence, reliabilityBuckets: metrics.reliabilityBuckets, provenance: "VERIFIED_RUNTIME_ONLY", liveAuthority: "NONE", productionMutationAllowed: false });
  }
}
