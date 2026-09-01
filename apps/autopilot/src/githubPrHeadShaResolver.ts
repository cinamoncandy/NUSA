/**
 * Resolves an open pull request by its exact current head SHA, for the case where
 * workflow_run.pull_requests is empty (dispatchPlanner.ts: PR_CI_SUCCEEDED with prNumber: null).
 *
 * GitHub's workflow_run.pull_requests array is empty for cross-repository PRs, PRs from forks
 * with restricted permissions, and some pull_request_target-triggered runs -- it is not a
 * reliable "no PR exists" signal. This module provides the fallback: given the exact head SHA the
 * canonical CI workflow_run reports, look up which open PR (if any) currently has that exact head.
 *
 * Fails closed toward "not resolved" (never guesses) when: zero matching open PRs, more than one
 * matching open PR, the API call itself fails/errors, or the response is malformed. A caller must
 * treat an unresolved result exactly like "no PR identity" -- planAutopilotExecution already NOOPs
 * a null prNumber, so no downstream change is needed for the fail-closed path.
 */
export interface GithubPrHeadShaResolverConfig {
  readonly token?: string;
  readonly allowedRepository: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface GithubPrHeadShaResolution {
  readonly resolved: boolean;
  readonly prNumber: number | null;
  readonly reason: string;
}

const SHA40 = /^[0-9a-f]{40}$/i;

function unresolved(reason: string): GithubPrHeadShaResolution {
  return Object.freeze({ resolved: false, prNumber: null, reason });
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-autopilot-worker",
    "x-github-api-version": "2022-11-28",
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Looks up open pull requests currently pointing at exactly `headSha` in `config.allowedRepository`.
 * Resolves only when exactly one such PR exists; otherwise fails closed with a specific reason.
 */
export async function resolveOpenPullRequestByHeadSha(
  headSha: string,
  config: GithubPrHeadShaResolverConfig,
): Promise<GithubPrHeadShaResolution> {
  const normalizedHead = headSha?.trim().toLowerCase() ?? "";
  if (!SHA40.test(normalizedHead)) return unresolved("head-sha-invalid");
  if (!config.token) return unresolved("github-token-required");
  if (!config.allowedRepository?.trim()) return unresolved("allowed-repository-required");

  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${base}/repos/${config.allowedRepository}/commits/${normalizedHead}/pulls`, {
      headers: githubHeaders(config.token),
    });
  } catch {
    return unresolved("github-api-request-failed");
  }
  if (response.status === 401 || response.status === 403) return unresolved("github-api-auth-rejected");
  if (response.status === 404) return unresolved("github-api-commit-not-found");
  if (!response.ok) return unresolved(`github-api-http-${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unresolved("github-api-response-invalid");
  }
  if (!Array.isArray(payload)) return unresolved("github-api-response-invalid");

  // Only PRs currently, exactly at this head qualify -- this endpoint returns every PR that ever
  // contained the commit, including PRs whose head has since moved on (stale) or that are closed.
  const matches = payload.filter((entry) => {
    const pr = object(entry);
    if (!pr) return false;
    if (pr.state !== "open") return false;
    const head = object(pr.head);
    const headRefSha = typeof head?.sha === "string" ? head.sha.trim().toLowerCase() : "";
    return headRefSha === normalizedHead;
  });

  if (matches.length === 0) return unresolved("no-open-pr-at-exact-head");
  if (matches.length > 1) return unresolved("ambiguous-multiple-open-prs-at-exact-head");

  const prNumber = object(matches[0])?.number;
  if (typeof prNumber !== "number" || !Number.isSafeInteger(prNumber) || prNumber <= 0) return unresolved("resolved-pr-number-invalid");

  return Object.freeze({ resolved: true, prNumber, reason: "resolved-unique-open-pr-at-exact-head" });
}
