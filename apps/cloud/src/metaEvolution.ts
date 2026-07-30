export interface EvolutionPolicyObservation {
  readonly policyId: string;
  readonly priorQuality: number;
  readonly currentQuality: number;
  readonly sampleCount: number;
  readonly minimumSamples: number;
}

export interface MetaEvolutionResult {
  readonly policyId: string;
  readonly decision: "REVIEW_REQUIRED" | "INSUFFICIENT_DATA" | "STABLE";
  readonly qualityDelta: number;
  readonly automaticPolicyChangeAllowed: false;
}

export const evaluateMetaEvolution = (observations: readonly EvolutionPolicyObservation[]): readonly MetaEvolutionResult[] => {
  const ids = new Set<string>();
  const results = observations.map((observation) => {
    if (!observation.policyId.trim() || ids.has(observation.policyId)) throw new Error("policy ids must be unique");
    ids.add(observation.policyId);
    if (!Number.isFinite(observation.priorQuality) || !Number.isFinite(observation.currentQuality) || observation.priorQuality < 0 || observation.priorQuality > 1 || observation.currentQuality < 0 || observation.currentQuality > 1) throw new Error("policy quality is invalid");
    if (!Number.isSafeInteger(observation.sampleCount) || !Number.isSafeInteger(observation.minimumSamples) || observation.sampleCount < 0 || observation.minimumSamples < 1) throw new Error("policy sample counts are invalid");
    const qualityDelta = observation.currentQuality - observation.priorQuality;
    const decision = observation.sampleCount < observation.minimumSamples ? "INSUFFICIENT_DATA" : qualityDelta < -0.05 ? "REVIEW_REQUIRED" : "STABLE";
    return Object.freeze({ policyId: observation.policyId, decision, qualityDelta, automaticPolicyChangeAllowed: false as const });
  });
  return Object.freeze(results);
};
