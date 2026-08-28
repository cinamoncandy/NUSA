export interface CodingRunnerRequest {
  readonly kind: "REPOSITORY_AUTOPILOT";
  readonly repository: string;
  readonly headSha: string;
  readonly workflowRunId: number | null;
  readonly reason: string;
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
}

const SHA40 = /^[0-9a-f]{40}$/i;
const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";

export function validateCodingRunnerRequest(value: unknown, allowedRepository = DEFAULT_REPOSITORY): CodingRunnerRequest {
  if (!value || typeof value !== "object") throw new Error("CODING_RUNNER_REQUEST_INVALID");
  const request = value as Record<string, unknown>;
  if (request.kind !== "REPOSITORY_AUTOPILOT") throw new Error("CODING_RUNNER_KIND_INVALID");
  if (request.repository !== allowedRepository) throw new Error("CODING_RUNNER_REPOSITORY_INVALID");
  if (typeof request.headSha !== "string" || !SHA40.test(request.headSha)) throw new Error("CODING_RUNNER_HEAD_SHA_INVALID");
  if (request.liveAuthority !== "NONE") throw new Error("CODING_RUNNER_LIVE_AUTHORITY_FORBIDDEN");
  if (request.productionMutationAllowed !== false || request.mutationAllowed !== false) throw new Error("CODING_RUNNER_PRODUCTION_MUTATION_FORBIDDEN");
  if (request.aiAuthority !== "ZERO_AUTHORITY") throw new Error("CODING_RUNNER_AI_AUTHORITY_INVALID");
  if (typeof request.reason !== "string" || !request.reason.trim()) throw new Error("CODING_RUNNER_REASON_REQUIRED");
  if (request.workflowRunId !== null && (!Number.isSafeInteger(request.workflowRunId) || Number(request.workflowRunId) < 0)) throw new Error("CODING_RUNNER_WORKFLOW_RUN_ID_INVALID");
  return Object.freeze(request as unknown as CodingRunnerRequest);
}

export async function executeCodingRunner(request: CodingRunnerRequest, env: CodingRunnerEnv): Promise<{ status: string; reason?: string; httpStatus?: number }> {
  const endpoint = env.NUSA_AI_CODING_ENDPOINT?.trim();
  const token = env.NUSA_AI_CODING_TOKEN?.trim();
  if (!endpoint || !token) return { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      task: "Implement the next safe NUSA repository improvement, run tests, and open a pull request. Never mutate LIVE trading or production authority.",
      repository: request.repository,
      headSha: request.headSha,
      workflowRunId: request.workflowRunId,
      reason: request.reason,
      constraints: { liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
    }),
  });
  if (!response.ok) return { status: "EXECUTION_FAILED", httpStatus: response.status };
  return { status: "EXECUTION_ACCEPTED", httpStatus: response.status };
}
