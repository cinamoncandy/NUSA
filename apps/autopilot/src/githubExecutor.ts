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
}

const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function result(status: GithubExecutorResult["status"], reason: string, httpStatus: number | null = null): GithubExecutorResult {
  return Object.freeze({ status, reason, httpStatus });
}

export async function executeGithubDispatch(
  request: AutopilotExecutionRequest,
  config: GithubExecutorConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubExecutorResult> {
  if (request.kind === "NOOP") return result("NOOP", "execution-request-noop");
  if (!config.token?.trim()) return result("INTERFACE_READY", "github-executor-token-not-configured");
  if (!REPOSITORY.test(config.allowedRepository)) return result("REJECTED", "github-executor-allowlist-invalid");
  if (request.repository !== config.allowedRepository) return result("REJECTED", "github-executor-repository-not-allowed");
  if (!request.headSha || !SHA40.test(request.headSha)) return result("REJECTED", "github-executor-head-sha-invalid");
  if (!Number.isSafeInteger(request.workflowRunId) || (request.workflowRunId ?? 0) <= 0) {
    return result("REJECTED", "github-executor-workflow-run-id-required");
  }

  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const response = await fetchImpl(`${base}/repos/${config.allowedRepository}/dispatches`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      "user-agent": "nusa-autopilot-worker",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: "nusa_autopilot_execution",
      client_payload: {
        kind: request.kind,
        repository: request.repository,
        head_sha: request.headSha,
        workflow_run_id: request.workflowRunId,
        reason: request.reason,
        live_authority: "NONE",
        production_mutation_allowed: false,
        ai_authority: "ZERO_AUTHORITY",
      },
    }),
  });

  if (response.status === 204) return result("DISPATCHED", "github-repository-dispatch-accepted", 204);
  if (response.status === 401 || response.status === 403) return result("FAILED", "github-executor-auth-rejected", response.status);
  if (response.status === 404) return result("FAILED", "github-executor-repository-or-token-scope-invalid", 404);
  return result("FAILED", `github-executor-http-${response.status}`, response.status);
}
