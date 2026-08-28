export type EvolutionScheduleMode = "MANUAL" | "AUTONOMOUS";

export interface EvolutionSchedulePolicy {
  readonly mode: EvolutionScheduleMode;
  readonly minIntervalSeconds: number;
  readonly maxConcurrent: number;
}

export interface EvolutionScheduleDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export function validateEvolutionSchedulePolicy(policy: EvolutionSchedulePolicy): EvolutionSchedulePolicy {
  if (!positiveInteger(policy.minIntervalSeconds)) throw new Error("EVOLVE_SCHEDULE_INTERVAL_INVALID");
  if (!positiveInteger(policy.maxConcurrent)) throw new Error("EVOLVE_SCHEDULE_CONCURRENCY_INVALID");
  return Object.freeze({ ...policy });
}

export function decideEvolutionSchedule(
  policy: EvolutionSchedulePolicy,
  activeExecutions: number,
  elapsedSecondsSinceLastRun: number,
): EvolutionScheduleDecision {
  const bounded = validateEvolutionSchedulePolicy(policy);
  if (bounded.mode !== "AUTONOMOUS") return Object.freeze({ allowed: false, reason: "manual-mode" });
  if (!Number.isInteger(activeExecutions) || activeExecutions < 0) return Object.freeze({ allowed: false, reason: "active-executions-invalid" });
  if (!Number.isFinite(elapsedSecondsSinceLastRun) || elapsedSecondsSinceLastRun < bounded.minIntervalSeconds) {
    return Object.freeze({ allowed: false, reason: "minimum-interval-not-reached" });
  }
  if (activeExecutions >= bounded.maxConcurrent) return Object.freeze({ allowed: false, reason: "concurrency-limit-reached" });
  return Object.freeze({ allowed: true, reason: "bounded-autonomous-window" });
}
