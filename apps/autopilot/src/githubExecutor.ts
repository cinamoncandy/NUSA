import type { AutopilotExecutionRequest } from "./executionPlanner";

export interface GithubExecutorConfig {
  readonly token?: string;
  readonly allowedRepository: string;
  readonly apiBaseUrl?: string;
}

export interface GithubExecutorResult {
  readonly status: "NOOP" | "INTERFACE_READY" | "DISPATCHED" | "REJECTED" | "FAILED";
  readonly reason: string;
  readonly httpStatus: number | null;
  readonly requestedHeadSha: string | null;
  readonly observedHeadSha: string | null;
}

const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EXECUTION_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const DEDUPE_KEY = /^[A-Za-z0-9_.:-]{1,256}$/;

function result(
  status: GithubExecutorResult["status"],
  reason: string,
  httpStatus: number | null = null,
  requestedHeadSha: string | null = null,
  observedHeadSha: string | null = null,
): GithubExecutorResult {
  return Object.freeze({ status, reason, httpStatus, requestedHeadSha, observedHeadSha });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-autopilot-worker",
    "x-github-api-version": "2022-11-28",
  };
}

async function resolveCurrentMainSha(
  base: string,
  repository: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GithubExecutorResult | string> {
  const response = await fetchImpl(`${base}/repos/${repository}/branches/main`, { headers: githubHeaders(token) });
  if (response.status === 401 || response.status === 403) return result("FAILED", "github-executor-auth-rejected", response.status);
  if (response.status === 404) return result("FAILED", "github-executor-repository-or-token-scope-invalid", 404);
  if (!response.ok) return result("FAILED", `github-executor-main-head-http-${response.status}`, response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return result("FAILED", "github-executor-main-head-invalid", response.status);
  }
  const sha = object(object(payload)?.commit)?.sha;
  if (typeof sha !== "string" || !SHA40.test(sha)) return result("FAILED", "github-executor-main-head-invalid", response.status);
  return sha.toLowerCase();
}

async function resolveCurrentPullRequestHead(
  base: string,
  repository: string,
  prNumber: number,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GithubExecutorResult | string> {
  const response = await fetchImpl(`${base}/repos/${repository}/pulls/${prNumber}`, { headers: githubHeaders(token) });
  if (response.status === 401 || response.status === 403) return result("FAILED", "github-executor-auth-rejected", response.status);
  if (response.status === 404) return result("FAILED", "github-executor-pr-or-token-scope-invalid", 404);
  if (!response.ok) return result("FAILED", `github-executor-pr-head-http-${response.status}`, response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return result("FAILED", "github-executor-pr-head-invalid", response.status);
  }
  const pr = object(payload);
  const sha = object(pr?.head)?.sha;
  if (pr?.state !== "open") return result("REJECTED", "github-executor-pr-not-open", response.status);
  if (typeof sha !== "string" || !SHA40.test(sha)) return result("FAILED", "github-executor-pr-head-invalid", response.status);
  return sha.toLowerCase();
}

export async function executeGithubDispatch(
  request: AutopilotExecutionRequest,
  config: GithubExecutorConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubExecutorResult> {
  if (request.kind === "NOOP") return result("NOOP", "execution-request-noop");
  const token = config.token?.trim();
  if (!token) return result("INTERFACE_READY", "github-executor-token-not-configured");
  if (!REPOSITORY.test(config.allowedRepository)) return result("REJECTED", "github-executor-allowlist-invalid");
  if (request.repository !== config.allowedRepository) return result("REJECTED", "github-executor-repository-not-allowed");
  if (!request.headSha || !SHA40.test(request.headSha)) return result("REJECTED", "github-executor-head-sha-invalid");
  if (!Number.isSafeInteger(request.workflowRunId) || (request.workflowRunId ?? 0) <= 0) {
    return result("REJECTED", "github-executor-workflow-run-id-required");
  }
  if (request.kind === "REPOSITORY_AUTOPILOT" || request.kind === "AUDIT_REQUEST") {
    if (!request.executionId || !EXECUTION_ID.test(request.executionId)) return result("REJECTED", "github-executor-execution-id-required");
    if (!request.dedupeKey || !DEDUPE_KEY.test(request.dedupeKey)) return result("REJECTED", "github-executor-dedupe-key-required");
  }
  if (request.kind === "AUDIT_REQUEST" && (!Number.isSafeInteger(request.prNumber) || (request.prNumber ?? 0) <= 0)) {
    return result("REJECTED", "github-executor-pr-number-required");
  }

  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const currentHead = request.kind === "AUDIT_REQUEST"
    ? await resolveCurrentPullRequestHead(base, config.allowedRepository, request.prNumber!, token, fetchImpl)
    : await resolveCurrentMainSha(base, config.allowedRepository, token, fetchImpl);
  if (typeof currentHead !== "string") return currentHead;
  const requestedHead = request.headSha.toLowerCase();
  if (currentHead !== requestedHead) {
    return result(
      "REJECTED",
      request.kind === "AUDIT_REQUEST" ? "github-executor-stale-pr-head-suppressed" : "github-executor-stale-head-suppressed",
      null,
      requestedHead,
      currentHead,
    );
  }

  const response = await fetchImpl(`${base}/repos/${config.allowedRepository}/dispatches`, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_type: "nusa_autopilot_execution",
      client_payload: {
        kind: request.kind,
        repository: request.repository,
        head_sha: request.headSha,
        pr_number: request.prNumber ?? null,
        workflow_run_id: request.workflowRunId,
        reason: request.reason,
        execution_id: request.executionId ?? null,
        dedupe_key: request.dedupeKey ?? null,
        live_authority: "NONE",
        production_mutation_allowed: false,
        ai_authority: "ZERO_AUTHORITY",
      },
    }),
  });

  if (response.status === 204) return result("DISPATCHED", "github-repository-dispatch-accepted", 204, requestedHead, currentHead);
  if (response.status === 401 || response.status === 403) return result("FAILED", "github-executor-auth-rejected", response.status, requestedHead, currentHead);
  if (response.status === 404) return result("FAILED", "github-executor-repository-or-token-scope-invalid", 404, requestedHead, currentHead);
  return result("FAILED", `github-executor-http-${response.status}`, response.status, requestedHead, currentHead);
}
