export type PaperValidationStatus = "PASS" | "WARNING" | "FAIL";

export interface PaperValidationDay {
  readonly date: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly plannedRuntimeMs: number;
  readonly actualRuntimeMs: number;
  readonly successfulRuns: number;
  readonly blockedRuns: number;
  readonly failedRuns: number;
  readonly incidents: number;
  readonly criticalIncidents: number;
  readonly snapshotFailures: number;
  readonly integrityChecksPassed: boolean;
}

export interface PaperValidationThresholds {
  readonly minimumCalendarDays: number;
  readonly minimumObservedDays: number;
  readonly minimumAvailabilityRatio: number;
  readonly maximumFailureRatio: number;
  readonly maximumCriticalIncidents: number;
  readonly maximumSnapshotFailureRatio: number;
}

export interface PaperValidationEvidence {
  readonly generatedAt: number;
  readonly status: PaperValidationStatus;
  readonly firstObservedAt: number | null;
  readonly lastObservedAt: number | null;
  readonly calendarDays: number;
  readonly observedDays: number;
  readonly totalRuns: number;
  readonly availabilityRatio: number;
  readonly failureRatio: number;
  readonly snapshotFailureRatio: number;
  readonly incidents: number;
  readonly criticalIncidents: number;
  readonly integrityFailures: number;
  readonly qualifyingDays: number;
  readonly reasons: readonly string[];
  readonly releaseReadinessPaperValidationDays: number;
}

const DAY_MS = 86_400_000;

const assertNonNegativeSafeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const assertRatio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const safeRatio = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

export function buildPaperValidationEvidence(
  days: readonly PaperValidationDay[],
  generatedAt: number,
  thresholds: PaperValidationThresholds
): PaperValidationEvidence {
  assertNonNegativeSafeInteger(generatedAt, "generatedAt");
  assertNonNegativeSafeInteger(thresholds.minimumCalendarDays, "minimumCalendarDays");
  assertNonNegativeSafeInteger(thresholds.minimumObservedDays, "minimumObservedDays");
  assertNonNegativeSafeInteger(thresholds.maximumCriticalIncidents, "maximumCriticalIncidents");
  if (thresholds.minimumCalendarDays === 0 || thresholds.minimumObservedDays === 0) throw new Error("minimum validation days must be greater than zero");
  assertRatio(thresholds.minimumAvailabilityRatio, "minimumAvailabilityRatio");
  assertRatio(thresholds.maximumFailureRatio, "maximumFailureRatio");
  assertRatio(thresholds.maximumSnapshotFailureRatio, "maximumSnapshotFailureRatio");

  const sorted = [...days].sort((a, b) => a.startedAt - b.startedAt || a.date.localeCompare(b.date));
  if (new Set(sorted.map((day) => day.date)).size !== sorted.length) throw new Error("Paper validation dates must be unique");

  for (const day of sorted) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error(`invalid Paper validation date: ${day.date}`);
    for (const [field, value] of Object.entries(day)) {
      if (field === "date" || field === "integrityChecksPassed") continue;
      assertNonNegativeSafeInteger(value as number, `${day.date}.${field}`);
    }
    if (day.completedAt < day.startedAt) throw new Error(`${day.date} completed before it started`);
    if (day.completedAt > generatedAt) throw new Error(`${day.date} completedAt cannot be in the future`);
    if (day.actualRuntimeMs > day.completedAt - day.startedAt) throw new Error(`${day.date} actualRuntimeMs exceeds observation window`);
  }

  const firstObservedAt = sorted[0]?.startedAt ?? null;
  const lastObservedAt = sorted.at(-1)?.completedAt ?? null;
  const calendarDays = firstObservedAt == null || lastObservedAt == null ? 0 : Math.floor((lastObservedAt - firstObservedAt) / DAY_MS) + 1;
  const observedDays = sorted.length;
  const plannedRuntimeMs = sorted.reduce((sum, day) => sum + day.plannedRuntimeMs, 0);
  const actualRuntimeMs = sorted.reduce((sum, day) => sum + day.actualRuntimeMs, 0);
  const totalRuns = sorted.reduce((sum, day) => sum + day.successfulRuns + day.blockedRuns + day.failedRuns, 0);
  const failedRuns = sorted.reduce((sum, day) => sum + day.failedRuns, 0);
  const snapshotFailures = sorted.reduce((sum, day) => sum + day.snapshotFailures, 0);
  const incidents = sorted.reduce((sum, day) => sum + day.incidents, 0);
  const criticalIncidents = sorted.reduce((sum, day) => sum + day.criticalIncidents, 0);
  const integrityFailures = sorted.filter((day) => !day.integrityChecksPassed).length;
  const availabilityRatio = safeRatio(actualRuntimeMs, plannedRuntimeMs);
  const failureRatio = safeRatio(failedRuns, totalRuns);
  const snapshotFailureRatio = safeRatio(snapshotFailures, totalRuns);

  const qualifyingDays = sorted.filter((day) => {
    const runs = day.successfulRuns + day.blockedRuns + day.failedRuns;
    return day.plannedRuntimeMs > 0
      && safeRatio(day.actualRuntimeMs, day.plannedRuntimeMs) >= thresholds.minimumAvailabilityRatio
      && safeRatio(day.failedRuns, runs) <= thresholds.maximumFailureRatio
      && safeRatio(day.snapshotFailures, runs) <= thresholds.maximumSnapshotFailureRatio
      && day.criticalIncidents === 0
      && day.integrityChecksPassed;
  }).length;

  const reasons: string[] = [];
  let status: PaperValidationStatus = "PASS";
  const fail = (reason: string): void => { status = "FAIL"; reasons.push(reason); };
  const warn = (reason: string): void => { if (status === "PASS") status = "WARNING"; reasons.push(reason); };

  if (calendarDays < thresholds.minimumCalendarDays) fail("Minimum calendar duration has not been reached");
  if (observedDays < thresholds.minimumObservedDays) fail("Insufficient observed Paper days");
  if (availabilityRatio < thresholds.minimumAvailabilityRatio) fail("Paper runtime availability is below threshold");
  if (failureRatio > thresholds.maximumFailureRatio) fail("Paper runtime failure ratio exceeded threshold");
  if (snapshotFailureRatio > thresholds.maximumSnapshotFailureRatio) fail("Snapshot failure ratio exceeded threshold");
  if (criticalIncidents > thresholds.maximumCriticalIncidents) fail("Critical incident threshold was exceeded");
  if (integrityFailures > 0) fail("One or more integrity checks failed");
  if (qualifyingDays < observedDays) warn("Some observed days did not meet daily quality thresholds");

  return deepFreeze({
    generatedAt,
    status,
    firstObservedAt,
    lastObservedAt,
    calendarDays,
    observedDays,
    totalRuns,
    availabilityRatio,
    failureRatio,
    snapshotFailureRatio,
    incidents,
    criticalIncidents,
    integrityFailures,
    qualifyingDays,
    reasons: [...new Set(reasons)],
    releaseReadinessPaperValidationDays: status === "PASS" ? qualifyingDays : 0
  });
}
