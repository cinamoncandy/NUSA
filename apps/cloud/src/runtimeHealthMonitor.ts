import type { RuntimeRunRecord, RuntimeStageStatus } from "./runtimeOrchestrator";

export type RuntimeHealthStatus = "HEALTHY" | "WARNING" | "CRITICAL" | "BLOCKED";

export interface RuntimeHealthThresholds {
  readonly maximumRunAgeMs: number;
  readonly maximumSnapshotAgeMs: number;
  readonly maximumQueueDepth: number;
  readonly maximumConsecutiveFailures: number;
  readonly warningAverageStageDurationMs: number;
}

export interface RuntimeHealthInput {
  readonly now: number;
  readonly records: readonly RuntimeRunRecord[];
  readonly snapshotGeneratedAt: number | null;
  readonly ipcHealthy: boolean;
  readonly queueDepth: number;
  readonly killSwitchActive: boolean;
}

export interface RuntimeStageHealth {
  readonly stage: string;
  readonly status: RuntimeHealthStatus;
  readonly runs: number;
  readonly successCount: number;
  readonly blockedCount: number;
  readonly failedCount: number;
  readonly averageDurationMs: number;
  readonly lastStatus: RuntimeStageStatus;
  readonly lastCompletedAt: number;
  readonly lastReason?: string;
}

export interface RuntimeHealthReport {
  readonly generatedAt: number;
  readonly status: RuntimeHealthStatus;
  readonly score: number;
  readonly consecutiveFailures: number;
  readonly lastSuccessfulRunAt: number | null;
  readonly snapshotAgeMs: number | null;
  readonly queueDepth: number;
  readonly ipcHealthy: boolean;
  readonly killSwitchActive: boolean;
  readonly reasons: readonly string[];
  readonly stages: readonly RuntimeStageHealth[];
}

const assertNonNegativeSafeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const rank: Record<RuntimeHealthStatus, number> = { HEALTHY: 0, WARNING: 1, CRITICAL: 2, BLOCKED: 3 };
const worse = (left: RuntimeHealthStatus, right: RuntimeHealthStatus): RuntimeHealthStatus => rank[left] >= rank[right] ? left : right;

const stageStatus = (lastStatus: RuntimeStageStatus, averageDurationMs: number, thresholds: RuntimeHealthThresholds): RuntimeHealthStatus => {
  if (lastStatus === "FAILED") return "CRITICAL";
  if (lastStatus === "BLOCKED") return "BLOCKED";
  if (lastStatus === "SKIPPED") return "WARNING";
  return averageDurationMs > thresholds.warningAverageStageDurationMs ? "WARNING" : "HEALTHY";
};

export function buildRuntimeHealthReport(input: RuntimeHealthInput, thresholds: RuntimeHealthThresholds): RuntimeHealthReport {
  assertNonNegativeSafeInteger(input.now, "now");
  assertNonNegativeSafeInteger(input.queueDepth, "queueDepth");
  for (const [field, value] of Object.entries(thresholds)) {
    assertNonNegativeSafeInteger(value, field);
    if (value === 0) throw new Error(`${field} must be greater than zero`);
  }
  if (input.snapshotGeneratedAt != null) {
    assertNonNegativeSafeInteger(input.snapshotGeneratedAt, "snapshotGeneratedAt");
    if (input.snapshotGeneratedAt > input.now) throw new Error("snapshotGeneratedAt cannot be in the future");
  }

  const records = [...input.records].sort((a, b) => a.completedAt - b.completedAt || a.runId.localeCompare(b.runId));
  if (new Set(records.map((record) => record.runId)).size !== records.length) throw new Error("runtime health records must have unique runId values");
  for (const record of records) {
    assertNonNegativeSafeInteger(record.startedAt, `${record.runId}.startedAt`);
    assertNonNegativeSafeInteger(record.completedAt, `${record.runId}.completedAt`);
    if (record.completedAt < record.startedAt) throw new Error(`${record.runId} completed before it started`);
    if (record.completedAt > input.now) throw new Error(`${record.runId} completedAt cannot be in the future`);
  }

  let consecutiveFailures = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].status !== "FAILED") break;
    consecutiveFailures += 1;
  }

  const lastSuccessful = [...records].reverse().find((record) => record.status === "SUCCESS");
  const latest = records.at(-1);
  const reasons: string[] = [];
  let status: RuntimeHealthStatus = "HEALTHY";

  if (input.killSwitchActive) { status = "BLOCKED"; reasons.push("Kill Switch is active"); }
  if (!input.ipcHealthy) { status = worse(status, "CRITICAL"); reasons.push("IPC health check failed"); }
  if (input.queueDepth > thresholds.maximumQueueDepth) { status = worse(status, "WARNING"); reasons.push("Runtime queue depth exceeded threshold"); }
  if (consecutiveFailures >= thresholds.maximumConsecutiveFailures) { status = worse(status, "CRITICAL"); reasons.push("Consecutive runtime failures exceeded threshold"); }
  if (!latest) { status = worse(status, "WARNING"); reasons.push("No runtime records are available"); }
  else if (input.now - latest.completedAt > thresholds.maximumRunAgeMs) { status = worse(status, "WARNING"); reasons.push("Latest runtime run is stale"); }

  const snapshotAgeMs = input.snapshotGeneratedAt == null ? null : input.now - input.snapshotGeneratedAt;
  if (snapshotAgeMs == null) { status = worse(status, "WARNING"); reasons.push("No runtime snapshot is available"); }
  else if (snapshotAgeMs > thresholds.maximumSnapshotAgeMs) { status = worse(status, "WARNING"); reasons.push("Runtime snapshot is stale"); }

  const stageMap = new Map<string, { statuses: RuntimeStageStatus[]; durations: number[]; completedAt: number[]; reasons: (string | undefined)[] }>();
  for (const record of records) {
    for (const stage of record.stages) {
      const entry = stageMap.get(stage.stage) ?? { statuses: [], durations: [], completedAt: [], reasons: [] };
      entry.statuses.push(stage.status);
      entry.durations.push(stage.durationMs);
      entry.completedAt.push(stage.completedAt);
      entry.reasons.push(stage.reason);
      stageMap.set(stage.stage, entry);
    }
    for (const stage of record.skippedStages) {
      const entry = stageMap.get(stage) ?? { statuses: [], durations: [], completedAt: [], reasons: [] };
      entry.statuses.push("SKIPPED");
      entry.durations.push(0);
      entry.completedAt.push(record.completedAt);
      entry.reasons.push("Skipped after an earlier runtime stage stopped the run");
      stageMap.set(stage, entry);
    }
  }

  const stages = [...stageMap.entries()].map(([stage, entry]): RuntimeStageHealth => {
    const last = entry.statuses.length - 1;
    const averageDurationMs = entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length;
    const health = stageStatus(entry.statuses[last], averageDurationMs, thresholds);
    status = worse(status, health);
    if (health !== "HEALTHY") reasons.push(`${stage} stage is ${health}`);
    return {
      stage,
      status: health,
      runs: entry.statuses.length,
      successCount: entry.statuses.filter((value) => value === "SUCCESS").length,
      blockedCount: entry.statuses.filter((value) => value === "BLOCKED").length,
      failedCount: entry.statuses.filter((value) => value === "FAILED").length,
      averageDurationMs,
      lastStatus: entry.statuses[last],
      lastCompletedAt: entry.completedAt[last],
      ...(entry.reasons[last] ? { lastReason: entry.reasons[last] } : {})
    };
  }).sort((a, b) => a.stage.localeCompare(b.stage));

  const penalty = reasons.length * 8 + consecutiveFailures * 12 + (input.ipcHealthy ? 0 : 20) + (input.killSwitchActive ? 40 : 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return deepFreeze({
    generatedAt: input.now,
    status,
    score,
    consecutiveFailures,
    lastSuccessfulRunAt: lastSuccessful?.completedAt ?? null,
    snapshotAgeMs,
    queueDepth: input.queueDepth,
    ipcHealthy: input.ipcHealthy,
    killSwitchActive: input.killSwitchActive,
    reasons: [...new Set(reasons)],
    stages
  });
}
