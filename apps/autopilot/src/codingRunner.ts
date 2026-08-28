export interface CodingRunnerRequest {
  readonly kind: "REPOSITORY_AUTOPILOT";
  readonly repository: string;
  readonly headSha: string;
  readonly workflowRunId: number;
  readonly reason: string;
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly mutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface CodingRunnerEnv {
  NUSA_CODING_RUNNER_TOKEN?: string;
  NUSA_AI_CODING_ENDPOINT?: string;
  NUSA_AI_CODING_TOKEN?: string;
  NUSA_GITHUB_REPOSITORY?: string;
  NUSA_GITHUB_TOKEN?: string;
}

interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<HttpResponse>;

const SHA40 = /^[0-9a-f]{40}$/i;
const EXECUTION_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const DEDUPE_KEY = /^[A-Za-z0-9_.:-]{1,256}$/;
const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";
const GITHUB_API_ORIGIN = "https://api.github.com";

export function validateCodingRunnerRequest(value: unknown, allowedRepository = DEFAULT_REPOSITORY): CodingRunnerRequest {
  if (!value || typeof value !== "object") throw new Error("CODING_RUNNER_REQUEST_INVALID");
  const request = value as Record<string, unknown>;
  if (request.kind !== "REPOSITORY_AUTOPILOT") throw new Error("CODING_RUNNER_KIND_INVALID");
  if (request.repository !== allowedRepository) throw new Error("CODING_RUNNER_REPOSITORY_INVALID");
  if (typeof request.headSha !== "string" || !SHA40.test(request.headSha)) throw new Error("CODING_RUNNER_HEAD_SHA_INVALID");
  if (typeof request.executionId !== "string" || !EXECUTION_ID.test(request.executionId)) throw new Error("CODING_RUNNER_EXECUTION_ID_INVALID");
  if (typeof request.dedupeKey !== "string" || !DEDUPE_KEY.test(request.dedupeKey)) throw new Error("CODING_RUNNER_DEDUPE_KEY_INVALID");
  if (request.liveAuthority !== "NONE") throw new Error("CODING_RUNNER_LIVE_AUTHORITY_FORBIDDEN");
  if (request.productionMutationAllowed !== false || request.mutationAllowed !== false) throw new Error("CODING_RUNNER_PRODUCTION_MUTATION_FORBIDDEN");
  if (request.aiAuthority !== "ZERO_AUTHORITY") throw new Error("CODING_RUNNER_AI_AUTHORITY_INVALID");
  if (typeof request.reason !== "string" || !request.reason.trim()) throw new Error("CODING_RUNNER_REASON_REQUIRED");
  if (!Number.isSafeInteger(request.workflowRunId) || Number(request.workflowRunId) <= 0) throw new Error("CODING_RUNNER_WORKFLOW_RUN_ID_INVALID");
  return Object.freeze(request as unknown as CodingRunnerRequest);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODING_RUNNER_GITHUB_EVIDENCE_INVALID");
  return value as Record<string, unknown>;
}

export async function verifyCodingRunnerRequestAgainstGitHub(
  request: CodingRunnerRequest,
  githubToken: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<void> {
  const token = githubToken.trim();
  if (!token) throw new Error("CODING_RUNNER_GITHUB_TOKEN_REQUIRED");
  const repository = request.repository.split("/").map(encodeURIComponent).join("/");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };

  const commitResponse = await fetchImpl(`${GITHUB_API_ORIGIN}/repos/${repository}/commits/${request.headSha}`, { method: "GET", headers });
  if (commitResponse.status !== 200) throw new Error("CODING_RUNNER_HEAD_SHA_UNVERIFIED");
  const commit = object(await commitResponse.json());
  if (typeof commit.sha !== "string" || commit.sha.toLowerCase() !== request.headSha.toLowerCase()) throw new Error("CODING_RUNNER_HEAD_SHA_MISMATCH");

  const runResponse = await fetchImpl(`${GITHUB_API_ORIGIN}/repos/${repository}/actions/runs/${request.workflowRunId}`, { method: "GET", headers });
  if (runResponse.status !== 200) throw new Error("CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED");
  const run = object(await runResponse.json());
  const runRepository = object(run.repository);
  if (run.id !== request.workflowRunId) throw new Error("CODING_RUNNER_WORKFLOW_RUN_ID_MISMATCH");
  if (typeof run.head_sha !== "string" || run.head_sha.toLowerCase() !== request.headSha.toLowerCase()) throw new Error("CODING_RUNNER_WORKFLOW_HEAD_MISMATCH");
  if (runRepository.full_name !== request.repository) throw new Error("CODING_RUNNER_WORKFLOW_REPOSITORY_MISMATCH");
  if (run.status !== "completed" || run.conclusion !== "success") throw new Error("CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL");
  if (typeof run.head_branch !== "string" || !run.head_branch.trim()) throw new Error("CODING_RUNNER_WORKFLOW_BRANCH_INVALID");
}

export async function executeCodingRunner(
  request: CodingRunnerRequest,
  env: CodingRunnerEnv,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<{ status: string; reason?: string; httpStatus?: number }> {
  const endpoint = env.NUSA_AI_CODING_ENDPOINT?.trim();
  const token = env.NUSA_AI_CODING_TOKEN?.trim();
  if (!endpoint || !token) return { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" };
  const githubToken = env.NUSA_GITHUB_TOKEN?.trim();
  if (!githubToken) return { status: "INTERFACE_READY", reason: "github-verification-not-configured" };

  await verifyCodingRunnerRequestAgainstGitHub(request, githubToken, fetchImpl);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-nusa-execution-id": request.executionId,
      "x-nusa-dedupe-key": request.dedupeKey,
    },
    body: JSON.stringify({
      task: "Implement the next safe NUSA repository improvement, run tests, and open a pull request. Never mutate LIVE trading or production authority.",
      repository: request.repository,
      headSha: request.headSha,
      workflowRunId: request.workflowRunId,
      reason: request.reason,
      executionId: request.executionId,
      dedupeKey: request.dedupeKey,
      constraints: { liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
    }),
  });
  if (!response.ok) return { status: "EXECUTION_FAILED", httpStatus: response.status };
  return { status: "EXECUTION_ACCEPTED", httpStatus: response.status };
}
