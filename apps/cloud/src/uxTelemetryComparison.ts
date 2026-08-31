/**
 * Before/after UX metric comparison (NUSA governing charter section 41 and section 54).
 *
 * "단순히 예뻐 보인다고 유지하지 않는다" / "Merge is not completion" -- a UX change survives only on
 * measured evidence, classified the same way as any other merged change:
 * VERIFIED_IMPROVEMENT | NEUTRAL | REGRESSION | INSUFFICIENT.
 */
import type { UxMetricsSummary } from "./uxTelemetryMetrics";

export type UxMetricOutcome = "VERIFIED_IMPROVEMENT" | "NEUTRAL" | "REGRESSION" | "INSUFFICIENT";

/** All comparable metrics from UxMetricsSummary are "lower is better" except abandonment/error/friction, which are too -- every one of these is a burden metric. */
const COMPARABLE_METRICS = Object.freeze([
  "taskCompletionTimeMsMedian",
  "taskCompletionTapsMedian",
  "navigationDepthMax",
  "navigationDepthMean",
  "errorRate",
  "approvalFrictionRate",
  "abandonmentRate",
  "repeatActionRate",
] as const);

export type ComparableUxMetric = (typeof COMPARABLE_METRICS)[number];

export interface UxMetricComparison {
  readonly metric: ComparableUxMetric;
  readonly before: number | null;
  readonly after: number | null;
  readonly relativeChange: number | null;
  readonly outcome: UxMetricOutcome;
}

export interface UxMetricsComparisonResult {
  readonly schemaVersion: 1;
  readonly minimumSampleSize: number;
  readonly comparisons: readonly UxMetricComparison[];
  readonly overall: UxMetricOutcome;
}

const DEFAULT_MINIMUM_SAMPLE_SIZE = 20;
/** A change smaller than this is treated as noise, not a real shift, in either direction. */
const NEUTRAL_BAND = 0.05;

function classifyMetric(before: number | null, after: number | null, sufficientSample: boolean): { outcome: UxMetricOutcome; relativeChange: number | null } {
  if (!sufficientSample || before === null || after === null) return { outcome: "INSUFFICIENT", relativeChange: null };
  if (before === 0) return { outcome: after === 0 ? "NEUTRAL" : "REGRESSION", relativeChange: null };
  const relativeChange = (after - before) / before;
  if (Math.abs(relativeChange) < NEUTRAL_BAND) return { outcome: "NEUTRAL", relativeChange };
  // Every comparable metric here is a burden metric (lower is better).
  return { outcome: relativeChange < 0 ? "VERIFIED_IMPROVEMENT" : "REGRESSION", relativeChange };
}

/**
 * Compares a "before" and "after" UxMetricsSummary window metric-by-metric, then rolls the
 * per-metric outcomes into one overall verdict: any REGRESSION wins (never hide a regression
 * behind an average of unrelated improvements); otherwise any INSUFFICIENT sample makes the
 * overall verdict INSUFFICIENT; otherwise VERIFIED_IMPROVEMENT only if at least one metric
 * actually improved and none regressed; otherwise NEUTRAL.
 */
export function compareUxMetrics(
  before: UxMetricsSummary,
  after: UxMetricsSummary,
  minimumSampleSize = DEFAULT_MINIMUM_SAMPLE_SIZE,
): UxMetricsComparisonResult {
  const sufficientSample = before.sampleTaskCount >= minimumSampleSize && after.sampleTaskCount >= minimumSampleSize;

  const comparisons: UxMetricComparison[] = COMPARABLE_METRICS.map((metric) => {
    const { outcome, relativeChange } = classifyMetric(before[metric], after[metric], sufficientSample);
    return { metric, before: before[metric], after: after[metric], relativeChange, outcome };
  });

  const outcomes = comparisons.map((comparison) => comparison.outcome);
  let overall: UxMetricOutcome;
  if (outcomes.includes("REGRESSION")) overall = "REGRESSION";
  else if (outcomes.includes("INSUFFICIENT")) overall = "INSUFFICIENT";
  else if (outcomes.includes("VERIFIED_IMPROVEMENT")) overall = "VERIFIED_IMPROVEMENT";
  else overall = "NEUTRAL";

  return Object.freeze({
    schemaVersion: 1,
    minimumSampleSize,
    comparisons: Object.freeze(comparisons),
    overall,
  });
}
