export interface LearningObservation {
  readonly observationId: string;
  readonly modelId: string;
  readonly priorAccuracy: number;
  readonly currentAccuracy: number;
  readonly sampleCount: number;
  readonly minimumSamples: number;
}

export interface LearningResult {
  readonly observationId: string;
  readonly status: "LEARNING_RECOMMENDED" | "INSUFFICIENT_DATA" | "STABLE";
  readonly delta: number;
  readonly automaticModelChangeAllowed: false;
}

const probability = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

export const evaluateContinualLearning = (observations: readonly LearningObservation[]): readonly LearningResult[] => {
  const ids = new Set<string>();
  const results = observations.map((observation) => {
    if (!observation.observationId.trim() || !observation.modelId.trim() || ids.has(observation.observationId)) throw new Error("learning observation identity is invalid");
    ids.add(observation.observationId);
    probability(observation.priorAccuracy, "priorAccuracy");
    probability(observation.currentAccuracy, "currentAccuracy");
    if (!Number.isSafeInteger(observation.sampleCount) || !Number.isSafeInteger(observation.minimumSamples) || observation.sampleCount < 0 || observation.minimumSamples < 1) throw new Error("learning sample counts are invalid");
    const delta = observation.currentAccuracy - observation.priorAccuracy;
    const status = observation.sampleCount < observation.minimumSamples ? "INSUFFICIENT_DATA" : delta < -0.05 ? "LEARNING_RECOMMENDED" : "STABLE";
    return Object.freeze({ observationId: observation.observationId, status, delta, automaticModelChangeAllowed: false as const });
  });
  return Object.freeze(results);
};
