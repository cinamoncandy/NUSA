export type EngineeringBottleneckMetric = number | "UNKNOWN";

export type EngineeringSelfOptimizerEvidence = {
  observationCount: number;
  ciP95Normalized: EngineeringBottleneckMetric;
  conflictRate: EngineeringBottleneckMetric;
  reworkRate: EngineeringBottleneckMetric;
  idleRatio: EngineeringBottleneckMetric;
  blockedTimeRatio: EngineeringBottleneckMetric;
};

export type EngineeringOptimizationTarget =
  | "CI_CRITICAL_PATH"
  | "CONFLICT_ALLOCATION"
  | "REWORK_REDUCTION"
  | "IDLE_DEPENDENCY_FLOW"
  | "BLOCKED_TIME_REDUCTION"
  | "INSUFFICIENT_EVIDENCE";

export type EngineeringSelfOptimizerDecision = {
  target: EngineeringOptimizationTarget;
  classification: "MEASURED" | "INSUFFICIENT";
  evidence: Readonly<EngineeringSelfOptimizerEvidence>;
  dominantMetric: string | null;
  dominantValue: number | null;
  reasons: readonly string[];
};

const MIN_OBSERVATIONS = 4;

function validateMetric(name: string, value: EngineeringBottleneckMetric): void {
  if (value === "UNKNOWN") return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`ENGINEERING_SELF_OPTIMIZER_INVALID_${name.toUpperCase()}`);
  }
}

export function selectEngineeringSystemOptimization(
  evidence: EngineeringSelfOptimizerEvidence,
): EngineeringSelfOptimizerDecision {
  if (!Number.isSafeInteger(evidence.observationCount) || evidence.observationCount < 0) {
    throw new Error("ENGINEERING_SELF_OPTIMIZER_INVALID_OBSERVATIONCOUNT");
  }

  const metrics = {
    ciP95Normalized: evidence.ciP95Normalized,
    conflictRate: evidence.conflictRate,
    reworkRate: evidence.reworkRate,
    idleRatio: evidence.idleRatio,
    blockedTimeRatio: evidence.blockedTimeRatio,
  } as const;

  for (const [name, value] of Object.entries(metrics)) validateMetric(name, value);

  const unknown = Object.entries(metrics)
    .filter(([, value]) => value === "UNKNOWN")
    .map(([name]) => name)
    .sort();

  if (evidence.observationCount < MIN_OBSERVATIONS || unknown.length > 0) {
    return {
      target: "INSUFFICIENT_EVIDENCE",
      classification: "INSUFFICIENT",
      evidence,
      dominantMetric: null,
      dominantValue: null,
      reasons: [
        ...(evidence.observationCount < MIN_OBSERVATIONS ? ["INSUFFICIENT_OBSERVATION_COUNT"] : []),
        ...unknown.map((name) => `UNKNOWN_${name.toUpperCase()}`),
      ],
    };
  }

  const targetByMetric = {
    ciP95Normalized: "CI_CRITICAL_PATH",
    conflictRate: "CONFLICT_ALLOCATION",
    reworkRate: "REWORK_REDUCTION",
    idleRatio: "IDLE_DEPENDENCY_FLOW",
    blockedTimeRatio: "BLOCKED_TIME_REDUCTION",
  } as const;

  const measured = Object.entries(metrics)
    .map(([name, value]) => ({ name, value: value as number }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));

  const dominant = measured[0];
  if (!dominant) {
    return {
      target: "INSUFFICIENT_EVIDENCE",
      classification: "INSUFFICIENT",
      evidence,
      dominantMetric: null,
      dominantValue: null,
      reasons: ["NO_MEASURED_BOTTLENECKS"],
    };
  }

  return {
    target: targetByMetric[dominant.name as keyof typeof targetByMetric],
    classification: "MEASURED",
    evidence,
    dominantMetric: dominant.name,
    dominantValue: dominant.value,
    reasons: ["LARGEST_MEASURED_BOTTLENECK"],
  };
}
