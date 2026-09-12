export type GithubIssueWorkSupplyStatus = "OBSERVED" | "UNKNOWN";

export interface GithubIssueWorkSupplySnapshot {
  readonly status: GithubIssueWorkSupplyStatus;
  readonly rawOpenIssueCount: number | null;
  readonly readyWorkCount: null;
  readonly readyWorkStatus: "UNKNOWN";
  readonly reason: string;
}

export const UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY: GithubIssueWorkSupplySnapshot = Object.freeze({
  status: "UNKNOWN",
  rawOpenIssueCount: null,
  readyWorkCount: null,
  readyWorkStatus: "UNKNOWN",
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
    reason: "github-open-issue-backlog-observed-readiness-not-proven",
  });
}
