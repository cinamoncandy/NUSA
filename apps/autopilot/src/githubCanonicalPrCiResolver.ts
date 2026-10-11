import type { AutopilotDispatchPlan } from "./dispatchPlanner";

export interface GithubCanonicalPrCiResolverConfig {
  readonly token?: string;
  readonly allowedRepository: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface GithubCanonicalPrCiResolution {
  readonly resolved: boolean;
  readonly dispatch: AutopilotDispatchPlan | null;
  readonly reason: string;
}

const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CANONICAL_CI_NAME = "CI";
const CANONICAL_CI_PATH = ".github/workflows/ci.yml";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function unresolved(reason: string): GithubCanonicalPrCiResolution {
  return Object.freeze({ resolved: false, dispatch: null, reason });
}

function matchesExactPullRequest(run: Record<string, unknown>, prNumber: number, headSha: string): boolean {
  const pullRequests = run.pull_requests;
  if (!Array.isArray(pullRequests) || pullRequests.length !== 1) return false;
  const pullRequest = object(pullRequests[0]);
  const head = object(pullRequest?.head);
  const base = object(pullRequest?.base);
  return pullRequest?.number === prNumber
    && typeof head?.sha === "string"
    && head.sha.toLowerCase() === headSha
    && base?.ref === "main";
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-autopilot-worker",
    "x-github-api-version": "2022-11-28",
  };
}

/**
 * Resolves the one immutable canonical pull-request CI run for a ready_for_review PR head.
 * The workflow endpoint is scoped before pagination, and every returned run is still checked
 * against the complete canonical identity. Any missing, malformed, stale, or conflicting
 * evidence fails closed instead of selecting a "newest" run.
 */
export async function resolveCanonicalPrCiForReady(
  dispatch: AutopilotDispatchPlan,
  config: GithubCanonicalPrCiResolverConfig,
): Promise<GithubCanonicalPrCiResolution> {
  if (dispatch.kind !== "PR_CHANGED" || dispatch.reason !== "pull-request:ready_for_review") return unresolved("ready-for-review-dispatch-required");
  const repository = dispatch.repository?.trim() ?? "";
  const headSha = dispatch.headSha?.trim().toLowerCase() ?? "";
  const prNumber = dispatch.prNumber;
  const token = config.token?.trim();
  if (!token) return unresolved("github-token-required");
  if (!REPOSITORY.test(repository) || repository !== config.allowedRepository) return unresolved("repository-not-allowed");
  if (!SHA40.test(headSha)) return unresolved("head-sha-invalid");
  if (!Number.isSafeInteger(prNumber) || (prNumber ?? 0) <= 0) return unresolved("pr-number-invalid");

  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const runs: Record<string, unknown>[] = [];
  let expectedTotal: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ event: "pull_request", status: "completed", head_sha: headSha, per_page: String(PAGE_SIZE), page: String(page) });
    let response: Response;
    try {
      response = await fetchImpl(`${base}/repos/${repository}/actions/workflows/ci.yml/runs?${query.toString()}`, { headers: githubHeaders(token) });
    } catch {
      return unresolved("github-api-request-failed");
    }
    if (response.status === 401 || response.status === 403) return unresolved("github-api-auth-rejected");
    if (response.status === 404) return unresolved("canonical-ci-workflow-not-found");
    if (!response.ok) return unresolved(`github-api-http-${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unresolved("github-api-response-invalid");
    }
    const body = object(payload);
    const pageRuns = body?.workflow_runs;
    const totalCount = body?.total_count;
    if (!body || !Array.isArray(pageRuns) || typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0) {
      return unresolved("github-api-response-invalid");
    }
    if (expectedTotal === null) expectedTotal = totalCount;
    if (expectedTotal !== totalCount) return unresolved("github-api-pagination-inconsistent");
    for (const candidate of pageRuns) {
      const run = object(candidate);
      if (!run) return unresolved("canonical-ci-run-malformed");
      runs.push(run);
    }
    if (pageRuns.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) return unresolved("github-api-pagination-limit-exceeded");
  }

  if (expectedTotal === null || runs.length !== expectedTotal) return unresolved("github-api-pagination-incomplete");
  if (runs.length === 0) return unresolved("canonical-ci-run-not-found");

  const canonical = runs.filter((run) => {
    const runRepository = object(run.repository);
    return run.name === CANONICAL_CI_NAME
      && run.path === CANONICAL_CI_PATH
      && run.event === "pull_request"
      && run.status === "completed"
      && typeof run.head_sha === "string"
      && run.head_sha.toLowerCase() === headSha
      && runRepository?.full_name === repository
      && matchesExactPullRequest(run, prNumber!, headSha);
  });
  if (canonical.length === 0) return unresolved("canonical-ci-run-identity-invalid");
  if (canonical.length !== 1 || runs.length !== 1) return unresolved("canonical-ci-run-ambiguous");

  const run = canonical[0]!;
  if (run.conclusion !== "success") return unresolved("canonical-ci-run-not-successful");
  const workflowRunId = positiveInteger(run.id);
  if (!workflowRunId) return unresolved("canonical-ci-run-id-invalid");
  // Carry the attempt so a replayed Audit for a re-run is a distinct execution identity rather
  // than a duplicate of the first attempt. Absent run_attempt means the first attempt.
  const workflowRunAttempt = positiveInteger(run.run_attempt) ?? 1;

  return Object.freeze({
    resolved: true,
    reason: "resolved-canonical-pr-ci-for-ready",
    dispatch: Object.freeze({
      kind: "PR_CI_SUCCEEDED",
      repository,
      headSha,
      prNumber: prNumber!,
      workflowRunAttempt,
      workflowRunId,
      reason: "pull-request-ci-success:ready-for-review-replay",
      mutationAllowed: false,
    }),
  });
}
