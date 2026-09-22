export type PaperPerformanceStatisticStatus = "AVAILABLE" | "INSUFFICIENT";

export interface PaperPerformanceStatistic {
  readonly status: PaperPerformanceStatisticStatus;
  readonly value?: number;
  readonly reason?: "INSUFFICIENT_OBSERVATIONS" | "CADENCE_UNSPECIFIED" | "ZERO_VARIANCE";
}

export interface PaperPerformanceCadence {
  readonly observationIntervalMs: number;
  readonly periodsPerYear: number;
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

export function assertPaperPerformanceCadence(cadence: PaperPerformanceCadence): void {
  if (!Number.isSafeInteger(cadence.observationIntervalMs) || cadence.observationIntervalMs <= 0) throw new Error("PAPER_PERFORMANCE_CADENCE_INVALID");
  if (!Number.isSafeInteger(cadence.periodsPerYear) || cadence.periodsPerYear <= 0) throw new Error("PAPER_PERFORMANCE_ANNUALIZATION_INVALID");
}

export function assertUniformPaperPerformanceObservations(observedAt: readonly number[], cadence: PaperPerformanceCadence): void {
  assertPaperPerformanceCadence(cadence);
  if (observedAt.length < 3) throw new Error("PAPER_PERFORMANCE_INSUFFICIENT_OBSERVATIONS");
  for (let index = 1; index < observedAt.length; index += 1) {
    if (!Number.isSafeInteger(observedAt[index]) || observedAt[index] - observedAt[index - 1] !== cadence.observationIntervalMs) throw new Error("PAPER_PERFORMANCE_NON_UNIFORM_CADENCE");
  }
}

const round8 = (value: number): number => Number(value.toFixed(8));

function sampleDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

export function calculatePaperPerformanceRiskStatistics(
  equity: readonly number[], observedAt: readonly number[], cadence: PaperPerformanceCadence,
): Readonly<{ volatility: PaperPerformanceStatistic; sharpe: PaperPerformanceStatistic; sortino: PaperPerformanceStatistic }> {
  assertUniformPaperPerformanceObservations(observedAt, cadence);
  if (equity.length !== observedAt.length || equity.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("PAPER_PERFORMANCE_STATISTIC_INPUT_INVALID");
  const returns = equity.slice(1).map((value, index) => value / equity[index] - 1);
  const annualizer = Math.sqrt(cadence.periodsPerYear);
  const deviation = sampleDeviation(returns);
  if (deviation === 0) {
    const zero = unavailablePaperPerformanceStatistic("ZERO_VARIANCE");
    return Object.freeze({ volatility: availablePaperPerformanceStatistic(0), sharpe: zero, sortino: zero });
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length < 2 ? 0 : Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length);
  return Object.freeze({
    volatility: availablePaperPerformanceStatistic(round8(deviation * annualizer)),
    sharpe: availablePaperPerformanceStatistic(round8((mean / deviation) * annualizer)),
    sortino: downsideDeviation === 0 ? unavailablePaperPerformanceStatistic("INSUFFICIENT_OBSERVATIONS") : availablePaperPerformanceStatistic(round8((mean / downsideDeviation) * annualizer)),
  });
}
