export type GithubIssueWorkSupplyStatus = "OBSERVED" | "UNKNOWN";
export type GithubReadyWorkScope = "AUTOPILOT_CODING_RUNNER" | "UNKNOWN";

export interface GithubIssueWorkSupplySnapshot {
  readonly status: GithubIssueWorkSupplyStatus;
  readonly rawOpenIssueCount: number | null;
  readonly readyWorkCount: number | null;
  readonly readyWorkStatus: "OBSERVED" | "UNKNOWN";
  readonly readyWorkScope: GithubReadyWorkScope;
  readonly capabilityBlockedWorkCount: number | null;
  readonly capabilityBlockedWorkStatus: "OBSERVED" | "UNKNOWN";
  readonly capabilityBlockedCapabilities: Readonly<Record<"RESEARCH" | "GENERAL" | "UNKNOWN", number>> | null;
  readonly reason: string;
}

export const UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY: GithubIssueWorkSupplySnapshot = Object.freeze({
  status: "UNKNOWN",
  rawOpenIssueCount: null,
  readyWorkCount: null,
  readyWorkStatus: "UNKNOWN",
  readyWorkScope: "UNKNOWN",
  capabilityBlockedWorkCount: null,
  capabilityBlockedWorkStatus: "UNKNOWN",
  capabilityBlockedCapabilities: null,
  reason: "github-open-issue-supply-unobserved",
});

export function unknownGithubIssueWorkSupply(reason: string): GithubIssueWorkSupplySnapshot {
  const normalized = reason.trim();
  return Object.freeze({
    ...UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY,
    reason: normalized || UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY.reason,
  });
}

export function deriveGithubIssueWorkSupply(value: unknown): GithubIssueWorkSupplySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unknownGithubIssueWorkSupply("github-open-issue-search-invalid");
  }
  const totalCount = (value as { total_count?: unknown }).total_count;
  if (!Number.isSafeInteger(totalCount) || Number(totalCount) < 0) {
    return unknownGithubIssueWorkSupply("github-open-issue-count-invalid");
  }
  return Object.freeze({
    status: "OBSERVED",
    rawOpenIssueCount: Number(totalCount),
    readyWorkCount: null,
    readyWorkStatus: "UNKNOWN",
    readyWorkScope: "UNKNOWN",
    reason: "github-open-issue-backlog-observed-current-executor-readiness-not-proven",
  });
}

export function withObservedReadyWork(
  supply: GithubIssueWorkSupplySnapshot,
  readyWorkCount: number,
): GithubIssueWorkSupplySnapshot {
  if (supply.status !== "OBSERVED" || !Number.isSafeInteger(readyWorkCount) || readyWorkCount < 0) {
    return supply.status === "OBSERVED"
      ? Object.freeze({ ...supply, readyWorkCount: null, readyWorkStatus: "UNKNOWN" as const, readyWorkScope: "UNKNOWN" as const, reason: "github-current-executor-ready-work-count-invalid" })
      : supply;
  }
  return Object.freeze({
    ...supply,
    readyWorkCount,
    readyWorkStatus: "OBSERVED" as const,
    readyWorkScope: "AUTOPILOT_CODING_RUNNER" as const,
    reason: "github-open-issue-backlog-and-current-executor-ready-work-observed",
  });
}

export function withObservedCapabilityBlockedWork(
  supply: GithubIssueWorkSupplySnapshot,
  capabilityBlockedWorkCount: number,
  capabilityBlockedCapabilities: Readonly<Record<"RESEARCH" | "GENERAL" | "UNKNOWN", number>>,
): GithubIssueWorkSupplySnapshot {
  const validCounts = Object.values(capabilityBlockedCapabilities).every((value) => Number.isSafeInteger(value) && value >= 0);
  if (supply.status !== "OBSERVED"
    || !Number.isSafeInteger(capabilityBlockedWorkCount)
    || capabilityBlockedWorkCount < 0
    || !validCounts
    || Object.values(capabilityBlockedCapabilities).reduce((sum, value) => sum + value, 0) !== capabilityBlockedWorkCount) {
    return supply.status === "OBSERVED"
      ? Object.freeze({ ...supply, capabilityBlockedWorkCount: null, capabilityBlockedWorkStatus: "UNKNOWN" as const, capabilityBlockedCapabilities: null, reason: "github-capability-blocked-work-count-invalid" })
      : supply;
  }
  return Object.freeze({
    ...supply,
    capabilityBlockedWorkCount,
    capabilityBlockedWorkStatus: "OBSERVED" as const,
    capabilityBlockedCapabilities: Object.freeze({ ...capabilityBlockedCapabilities }),
    reason: supply.readyWorkStatus === "OBSERVED"
      ? "github-open-issue-backlog-current-executor-ready-and-capability-blocked-work-observed"
      : supply.reason,
  });
}
