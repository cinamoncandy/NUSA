import type { RuntimeRunRecord } from "./runtimeOrchestrator";

export interface RuntimeIncidentReport {
  readonly incidentId: string;
  readonly runId: string;
  readonly severity: "WARNING" | "CRITICAL";
  readonly status: "BLOCKED" | "FAILED";
  readonly failedStage: string | null;
  readonly cause: string;
  readonly affectedStages: readonly string[];
  readonly recommendation: string;
  readonly createdAt: number;
}

export const createRuntimeIncidentReport = (record: RuntimeRunRecord, createdAt: number): RuntimeIncidentReport | null => {
  if (record.status === "SUCCESS") return null;
  if (!Number.isSafeInteger(createdAt) || createdAt < record.completedAt) throw new Error("incident createdAt is invalid");
  const terminal = [...record.stages].reverse().find((stage) => stage.status !== "SUCCESS");
  const failedStage = terminal?.stage ?? null;
  const cause = terminal?.reason ?? (record.status === "BLOCKED" ? "Runtime blocked before stage execution" : "Runtime failed without stage detail");
  const recommendation = record.status === "FAILED"
    ? "Keep PAPER runtime stopped, review the failed stage, and require operator approval before retry."
    : "Keep downstream stages blocked until the policy gate is cleared.";
  const report: RuntimeIncidentReport = {
    incidentId: `${record.runId}:${record.status}:${record.completedAt}`,
    runId: record.runId,
    severity: record.status === "FAILED" ? "CRITICAL" : "WARNING",
    status: record.status,
    failedStage,
    cause,
    affectedStages: [...record.skippedStages],
    recommendation,
    createdAt
  };
  Object.freeze(report.affectedStages);
  return Object.freeze(report);
};
