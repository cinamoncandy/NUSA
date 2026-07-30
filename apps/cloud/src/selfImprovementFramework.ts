export interface ImprovementObservation {
  readonly observationId: string;
  readonly metric: string;
  readonly baseline: number;
  readonly current: number;
  readonly threshold: number;
}

export interface ImprovementProposal {
  readonly observationId: string;
  readonly status: "REVIEW_REQUIRED" | "NO_CHANGE";
  readonly reason: string;
  readonly automaticChangeAllowed: false;
}

export const generateImprovementProposals = (observations: readonly ImprovementObservation[]): readonly ImprovementProposal[] => {
  const ids = new Set<string>();
  const proposals = observations.map((observation) => {
    if (!observation.observationId.trim() || ids.has(observation.observationId)) throw new Error("observation ids must be unique");
    ids.add(observation.observationId);
    if (!observation.metric.trim() || !Number.isFinite(observation.baseline) || !Number.isFinite(observation.current) || !Number.isFinite(observation.threshold) || observation.threshold < 0) throw new Error("improvement observation is invalid");
    const degraded = Math.abs(observation.current - observation.baseline) > observation.threshold;
    return Object.freeze({ observationId: observation.observationId, status: degraded ? "REVIEW_REQUIRED" : "NO_CHANGE", reason: degraded ? `METRIC_DEGRADED:${observation.metric}` : "WITHIN_THRESHOLD", automaticChangeAllowed: false as const });
  });
  return Object.freeze(proposals);
};
