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
