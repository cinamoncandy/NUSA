export type PaperPerformanceStatisticStatus = "AVAILABLE" | "INSUFFICIENT";

export interface PaperPerformanceStatistic {
  readonly status: PaperPerformanceStatisticStatus;
  readonly value?: number;
  readonly reason?: "INSUFFICIENT_OBSERVATIONS" | "CADENCE_UNSPECIFIED" | "ZERO_VARIANCE";
}

export function unavailablePaperPerformanceStatistic(
  reason: NonNullable<PaperPerformanceStatistic["reason"]>,
): PaperPerformanceStatistic {
  return Object.freeze({ status: "INSUFFICIENT" as const, reason });
}

export function availablePaperPerformanceStatistic(value: number): PaperPerformanceStatistic {
  if (!Number.isFinite(value)) throw new Error("PAPER_PERFORMANCE_STATISTIC_NON_FINITE");
  return Object.freeze({ status: "AVAILABLE" as const, value });
}

export interface PaperPerformanceCadence {
  readonly observationIntervalMs: number;
  readonly periodsPerYear: number;
}

export function assertPaperPerformanceCadence(cadence: PaperPerformanceCadence): void {
  if (!Number.isSafeInteger(cadence.observationIntervalMs) || cadence.observationIntervalMs <= 0) {
    throw new Error("PAPER_PERFORMANCE_CADENCE_INVALID");
  }
  if (!Number.isSafeInteger(cadence.periodsPerYear) || cadence.periodsPerYear <= 0) {
    throw new Error("PAPER_PERFORMANCE_ANNUALIZATION_INVALID");
  }
}

export function assertUniformPaperPerformanceObservations(
  observedAt: readonly number[],
  cadence: PaperPerformanceCadence,
): void {
  assertPaperPerformanceCadence(cadence);
  if (observedAt.length < 3) throw new Error("PAPER_PERFORMANCE_INSUFFICIENT_OBSERVATIONS");
  for (let index = 1; index < observedAt.length; index += 1) {
    if (!Number.isSafeInteger(observedAt[index]) || observedAt[index] - observedAt[index - 1] !== cadence.observationIntervalMs) {
      throw new Error("PAPER_PERFORMANCE_NON_UNIFORM_CADENCE");
    }
  }
}
