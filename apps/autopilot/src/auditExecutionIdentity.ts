import type { AuditRunnerRequest } from "./auditRunner";

export type AuditExecutionIdentity = Pick<AuditRunnerRequest, "repository" | "prNumber" | "headSha" | "baseSha" | "workflowRunId">;

export function canonicalAuditDedupeKey(identity: AuditExecutionIdentity): string {
  return [
    "audit-v1",
    identity.repository,
    String(identity.prNumber),
    identity.headSha.toLowerCase(),
    identity.baseSha.toLowerCase(),
    String(identity.workflowRunId),
  ].join(":");
}

export function isRetryableAuditExecutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:^|\D)429(?:\D|$)|(?:^|\D)5\d\d(?:\D|$)|timeout|timed out|fetch failed|temporar|network|ECONN/i.test(message);
}
