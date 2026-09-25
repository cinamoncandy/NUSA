import { adviseConcurrency, type ConcurrencyEvidence, type ConcurrencyRecommendation } from "./concurrencyAdvisor";
import type { EvidenceConfidence } from "./opportunityPlanner";
import type { WorkerPoolMetrics } from "./worktreeWorkerPool";
import type { AutopilotExecutionTelemetry } from "./executionTelemetry";

/**
 * Turns measured worker outcomes into the evidence `adviseConcurrency` consumes.
 *
 * The advisor already exists and is already fail-closed, but nothing in the repository calls it,
 * because nothing produces a `ConcurrencyEvidence`. That is the actual gap: the concurrency policy
 * has no input, so "do not raise WIP" is a standing instruction rather than a measured conclusion.
 *
 * The one rule this module exists to enforce is that an unmeasured input is never reported as a
 * measured zero. A missing CI utilisation is not idle capacity, and a throughput trend with no
 * prior window to compare against is not a flat trend. Both of those mistakes read as headroom,
 * and headroom is what makes the advisor recommend more concurrency. So anything unmeasured
 * degrades confidence, and confidence below VERIFIED makes the advisor HOLD.
 */

export interface WorkerOutcome {
  readonly metrics: WorkerPoolMetrics;
  /** The task reached a verified result: exact-head CI green, Audit and Release satisfied. */
  readonly verified: boolean;
  /** The task needed at least one repair round after a failed verification. */
  readonly reworked: boolean;
  /** The task was blocked or abandoned because another claim held an overlapping conflict key. */
  readonly conflicted: boolean;
}

/**
 * Converts one canonical execution telemetry record plus the worker-pool timing metrics emitted by
 * completeWorkerClaim into a measured outcome. The two records must describe the same execution
 * interval; mismatches fail closed instead of fabricating throughput evidence.
 */
export function workerOutcomeFromTelemetry(
  metrics: WorkerPoolMetrics,
  telemetry: AutopilotExecutionTelemetry,
): WorkerOutcome | null {
  if (!validOutcome({ metrics, verified: false, reworked: false, conflicted: false })) return null;
  if (!Number.isSafeInteger(telemetry.timestampMs) || telemetry.timestampMs !== metrics.completedAt) return null;
  if (!Number.isSafeInteger(telemetry.attempt) || telemetry.attempt < 1) return null;

  const verified =
    telemetry.result === "SUCCESS"
    && telemetry.validationResult === "SUCCESS"
    && telemetry.ciResult === "SUCCESS"
    && telemetry.failureClass === null
    && telemetry.failureReason === null;

  const reworked = telemetry.attempt > 1 || telemetry.retry.attempt > 1 || telemetry.checkpoint.resumed;
  const conflicted = telemetry.failureReason !== null && /conflict/i.test(telemetry.failureReason);

  return Object.freeze({ metrics, verified, reworked, conflicted });
}

export interface ThroughputWindow {
  readonly source: string;
  readonly windowStartedAt: number;
  readonly windowEndedAt: number;
  readonly outcomes: readonly WorkerOutcome[];
  readonly currentWip: number;
  readonly maxWip: number;
  /**
   * Fraction of downstream verification capacity in use, or null when it was not measured.
   * null is not 0. Reporting an unmeasured value as 0 would read as idle capacity.
   */
  readonly ciUtilization: number | null;
  /**
   * Verified tasks per hour from the previous comparable window, or null when there is no prior
   * window. null is not a flat trend: a trend needs two measurements.
   */
  readonly priorVerifiedTasksPerHour: number | null;
}

export interface WorkerThroughputSummary {
  readonly source: string;
  readonly confidence: EvidenceConfidence;
  readonly sampleSize: number;
  readonly windowHours: number;
  /** null means NOT_MEASURED. It never means zero. */
  readonly verifiedTasksPerHour: number | null;
  readonly conflictRate: number | null;
  readonly reworkRate: number | null;
  readonly throughputTrend: number | null;
  readonly ciUtilization: number | null;
  /** Every input that could not be measured, named. */
  readonly unmeasured: readonly string[];
}

/**
 * Below this many completed outcomes a rate is arithmetic, not evidence: with two outcomes a
 * single repair round reads as a 50% rework rate.
 */
const MIN_SAMPLE = 5;
const MAX_SAMPLE = 10_000;
const HOUR_MS = 3_600_000;

const boundedRate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function validOutcome(value: unknown): value is WorkerOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Partial<WorkerOutcome>;
  const metrics = outcome.metrics;
  return typeof outcome.verified === "boolean"
    && typeof outcome.reworked === "boolean"
    && typeof outcome.conflicted === "boolean"
    && !!metrics && typeof metrics === "object"
    && typeof metrics.taskId === "string" && metrics.taskId.length > 0
    && Number.isSafeInteger(metrics.completedAt) && metrics.completedAt >= 0;
}

/**
 * Summarises one measured window. Unmeasurable inputs come back as null and are named in
 * `unmeasured`; they are never substituted with a value.
 */
export function summariseWorkerThroughput(window: ThroughputWindow): WorkerThroughputSummary {
  const unmeasured: string[] = [];
  const sourceValid = typeof window.source === "string" && window.source.trim().length > 0 && window.source.trim().length <= 256;
  const spanValid = Number.isSafeInteger(window.windowStartedAt) && Number.isSafeInteger(window.windowEndedAt) && window.windowEndedAt > window.windowStartedAt;
  const outcomesValid = Array.isArray(window.outcomes) && window.outcomes.length <= MAX_SAMPLE && window.outcomes.every(validOutcome);
  const wipValid = positiveInteger(window.currentWip) && positiveInteger(window.maxWip) && window.currentWip <= window.maxWip;

  if (!sourceValid || !spanValid || !outcomesValid || !wipValid) {
    return Object.freeze({
      source: sourceValid ? window.source.trim() : "invalid-window",
      confidence: "UNKNOWN" as const,
      sampleSize: 0,
      windowHours: 0,
      verifiedTasksPerHour: null,
      conflictRate: null,
      reworkRate: null,
      throughputTrend: null,
      ciUtilization: null,
      unmeasured: Object.freeze(["window"]),
    });
  }

  // Only outcomes that actually landed inside the window may be counted against its duration.
  const outcomes = window.outcomes.filter((outcome) => outcome.metrics.completedAt >= window.windowStartedAt && outcome.metrics.completedAt <= window.windowEndedAt);
  const sampleSize = outcomes.length;
  const windowHours = round4((window.windowEndedAt - window.windowStartedAt) / HOUR_MS);

  const rated = sampleSize >= MIN_SAMPLE;
  if (!rated) unmeasured.push("sample-size");

  const verifiedTasksPerHour = rated && windowHours > 0 ? round4(outcomes.filter((outcome) => outcome.verified).length / windowHours) : null;
  const conflictRate = rated ? round4(outcomes.filter((outcome) => outcome.conflicted).length / sampleSize) : null;
  const reworkRate = rated ? round4(outcomes.filter((outcome) => outcome.reworked).length / sampleSize) : null;

  const prior = window.priorVerifiedTasksPerHour;
  const priorMeasured = prior === null ? false : typeof prior === "number" && Number.isFinite(prior) && prior >= 0;
  if (!priorMeasured) unmeasured.push("throughput-trend");
  const throughputTrend = priorMeasured && verifiedTasksPerHour !== null ? round4(verifiedTasksPerHour - (prior as number)) : null;

  const ciMeasured = boundedRate(window.ciUtilization);
  if (!ciMeasured) unmeasured.push("ci-utilization");
  const ciUtilization = ciMeasured ? round4(window.ciUtilization as number) : null;

  // VERIFIED requires every input the advisor reads. INSUFFICIENT is reserved for a window that is
  // structurally sound and simply too small; anything else unmeasured is UNKNOWN.
  const confidence: EvidenceConfidence = unmeasured.length === 0
    ? "VERIFIED"
    : unmeasured.length === 1 && unmeasured[0] === "sample-size"
      ? "INSUFFICIENT"
      : "UNKNOWN";

  return Object.freeze({
    source: window.source.trim(),
    confidence,
    sampleSize,
    windowHours,
    verifiedTasksPerHour,
    conflictRate,
    reworkRate,
    throughputTrend,
    ciUtilization,
    unmeasured: Object.freeze([...unmeasured]),
  });
}

/**
 * Projects a summary onto the advisor's input.
 *
 * A summary that is not VERIFIED still produces an evidence object, because the advisor is the
 * component that owns the refusal: it reads a non-VERIFIED confidence and returns HOLD. The
 * numeric fields are filled with values that cannot read as headroom, so that even a caller that
 * ignored confidence entirely could not talk the advisor into raising concurrency.
 */
export function toConcurrencyEvidence(summary: WorkerThroughputSummary, currentWip: number, maxWip: number): ConcurrencyEvidence {
  const verified = summary.confidence === "VERIFIED";
  return Object.freeze({
    source: summary.source,
    confidence: summary.confidence,
    currentWip,
    maxWip,
    // Unmeasured trend is reported as a decline, never as growth: growth is half of the headroom test.
    throughputTrend: verified && summary.throughputTrend !== null ? summary.throughputTrend : -1,
    // Unmeasured pressure is reported as maximal, never as absent.
    conflictRate: verified && summary.conflictRate !== null ? summary.conflictRate : 1,
    reworkRate: verified && summary.reworkRate !== null ? summary.reworkRate : 1,
    ciUtilization: verified && summary.ciUtilization !== null ? summary.ciUtilization : 1,
  });
}

export { MIN_SAMPLE as MINIMUM_THROUGHPUT_SAMPLE };


/**
 * Production-facing evaluation boundary for measured worker-pool outcomes.
 * This only returns an advisory recommendation; it never mutates pool WIP.
 */
export function evaluateWorkerPoolConcurrency(window: ThroughputWindow): ConcurrencyRecommendation {
  const summary = summariseWorkerThroughput(window);
  return adviseConcurrency(toConcurrencyEvidence(summary, window.currentWip, window.maxWip));
}
