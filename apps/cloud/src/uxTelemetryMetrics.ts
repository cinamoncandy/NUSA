/**
 * Pure UX metric computation over a durable event batch (NUSA governing charter section 40).
 *
 * Every function here is a pure function of an already-validated event list: no I/O, no network,
 * no LIVE authority. This is the "MEASURE" step of the section 41 friction loop
 * (OBSERVE -> FIND FRICTION -> HYPOTHESIS -> DESIGN -> IMPLEMENT -> MEASURE -> KEEP/REVERT).
 */
import type { UxTelemetryEvent } from "../../../packages/contracts/src/uxTelemetryEvent";

export interface UxMetricsSummary {
  readonly schemaVersion: 1;
  readonly sampleTaskCount: number;
  readonly sampleSessionCount: number;
  /** median across completed tasks; null when no task completed within this batch */
  readonly taskCompletionTimeMsMedian: number | null;
  readonly taskCompletionTapsMedian: number | null;
  readonly navigationDepthMax: number | null;
  readonly navigationDepthMean: number | null;
  readonly errorRate: number | null;
  readonly recoveryRate: number | null;
  readonly approvalFrictionRate: number | null;
  readonly abandonmentRate: number | null;
  readonly repeatActionRate: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function groupByTask(events: readonly UxTelemetryEvent[]): Map<string, UxTelemetryEvent[]> {
  const byTask = new Map<string, UxTelemetryEvent[]>();
  for (const event of events) {
    if (!event.taskId) continue;
    const list = byTask.get(event.taskId) ?? [];
    list.push(event);
    byTask.set(event.taskId, list);
  }
  return byTask;
}

/**
 * Summarizes UX metrics over one comparison window's events. `events` need not be pre-sorted or
 * scoped to one session -- this treats `sessionId`/`taskId` as the grouping keys.
 */
export function summarizeUxMetrics(events: readonly UxTelemetryEvent[]): UxMetricsSummary {
  const sorted = [...events].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  const sessionIds = new Set(sorted.map((event) => event.sessionId));
  const byTask = groupByTask(sorted);

  const completionTimesMs: number[] = [];
  const completionTaps: number[] = [];
  let startedTasks = 0;
  let completedTasks = 0;
  let abandonedTasks = 0;

  for (const taskEvents of byTask.values()) {
    const started = taskEvents.find((event) => event.kind === "TASK_STARTED");
    const completed = taskEvents.find((event) => event.kind === "TASK_COMPLETED");
    const abandoned = taskEvents.find((event) => event.kind === "TASK_ABANDONED");
    if (started) startedTasks += 1;
    if (completed) completedTasks += 1;
    if (abandoned) abandonedTasks += 1;
    if (started && completed) {
      completionTimesMs.push(completed.occurredAtMs - started.occurredAtMs);
      completionTaps.push(taskEvents.filter((event) => event.kind === "TAP" && event.occurredAtMs >= started.occurredAtMs && event.occurredAtMs <= completed.occurredAtMs).length);
    }
  }

  const navigationDepths = sorted
    .filter((event) => event.kind === "NAVIGATION_PUSH" && event.navigationDepth !== undefined)
    .map((event) => event.navigationDepth as number);

  const errorsShown = sorted.filter((event) => event.kind === "ERROR_SHOWN").length;
  const errorsRecovered = sorted.filter((event) => event.kind === "ERROR_RECOVERED").length;
  const approvalsRequested = sorted.filter((event) => event.kind === "APPROVAL_REQUESTED").length;
  const approvalsCancelled = sorted.filter((event) => event.kind === "APPROVAL_CANCELLED").length;
  const taps = sorted.filter((event) => event.kind === "TAP").length;
  const repeatActions = sorted.filter((event) => event.kind === "REPEAT_ACTION").length;

  return Object.freeze({
    schemaVersion: 1,
    sampleTaskCount: byTask.size,
    sampleSessionCount: sessionIds.size,
    taskCompletionTimeMsMedian: median(completionTimesMs),
    taskCompletionTapsMedian: median(completionTaps),
    navigationDepthMax: navigationDepths.length > 0 ? Math.max(...navigationDepths) : null,
    navigationDepthMean: mean(navigationDepths),
    errorRate: safeRate(errorsShown, sorted.length),
    recoveryRate: safeRate(errorsRecovered, errorsShown),
    approvalFrictionRate: safeRate(approvalsCancelled, approvalsRequested),
    abandonmentRate: safeRate(abandonedTasks, startedTasks),
    repeatActionRate: safeRate(repeatActions, taps),
  });
}
