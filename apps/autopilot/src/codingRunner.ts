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

export interface CodingProposal {
  readonly patch: string;
}

export interface CodingValidatedFile {
  readonly path: string;
  readonly content: string;
}

export interface CodingRuntimeExecutionResult {
  readonly backend: string;
  readonly checkpointId: string;
  readonly workspaceVerified: true;
  readonly proposalValidated?: true;
  readonly changedFiles?: readonly string[];
  readonly validatedFiles?: readonly CodingValidatedFile[];
}

export interface CodingRuntime {
  readonly name: string;
  execute(request: CodingRunnerRequest, proposal?: CodingProposal): Promise<CodingRuntimeExecutionResult>;
}

export interface CodingPublisherResult {
  readonly publisher: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
}

export interface CodingPublisher {
  readonly name: string;
  publish(request: CodingRunnerRequest, runtime: CodingRuntimeExecutionResult): Promise<CodingPublisherResult>;
}

export interface CodingRunnerResult {
  readonly status: string;
  readonly reason?: string;
  readonly httpStatus?: number;
  readonly backend?: string;
  readonly checkpointId?: string;
  readonly workspaceVerified?: true;
  readonly proposalValidated?: true;
  readonly changedFiles?: readonly string[];
  readonly publisher?: string;
  readonly branch?: string;
  readonly commitSha?: string;
  readonly pullRequestNumber?: number;
  readonly pullRequestUrl?: string;
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
const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";

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

function validateCodingProposal(value: unknown): CodingProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODING_PROPOSAL_INVALID");
  const proposal = value as Record<string, unknown>;
  if (typeof proposal.patch !== "string" || !proposal.patch.trim()) throw new Error("CODING_PROPOSAL_PATCH_REQUIRED");
  return Object.freeze({ patch: proposal.patch });
}

function githubModelsProposal(value: unknown): CodingProposal {
  const payload = object(value);
  if (!Array.isArray(payload.choices) || payload.choices.length < 1) throw new Error("CODING_PROPOSAL_INVALID");
  const choice = object(payload.choices[0]);
  const message = object(choice.message);
  if (typeof message.content !== "string" || !message.content.trim()) throw new Error("CODING_PROPOSAL_INVALID");
  try {
    return validateCodingProposal(JSON.parse(message.content));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CODING_PROPOSAL_")) throw error;
    throw new Error("CODING_PROPOSAL_INVALID");
  }
}

function publicRuntimeResult(runtime: CodingRuntimeExecutionResult): Pick<CodingRunnerResult, "backend" | "checkpointId" | "workspaceVerified" | "proposalValidated" | "changedFiles"> {
  return {
    backend: runtime.backend,
    checkpointId: runtime.checkpointId,
    workspaceVerified: runtime.workspaceVerified,
    proposalValidated: runtime.proposalValidated,
    changedFiles: runtime.changedFiles,
  };
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

function codingEngineRequest(request: CodingRunnerRequest, token: string): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-nusa-execution-id": request.executionId,
      "x-nusa-dedupe-key": request.dedupeKey,
    },
    body: JSON.stringify({
      task: "Propose the next safe NUSA repository improvement as a unified git patch. Do not mutate GitHub, open a pull request, access LIVE trading, or change production authority. Return JSON only with one field: patch.",
      repository: request.repository,
      headSha: request.headSha,
      workflowRunId: request.workflowRunId,
      reason: request.reason,
      executionId: request.executionId,
      dedupeKey: request.dedupeKey,
      outputContract: { patch: "unified-git-diff" },
      constraints: { mutationAllowed: false, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
    }),
  };
}

function githubModelsCodingRequest(request: CodingRunnerRequest, token: string): RequestInit {
  const userPrompt = [
    "Propose exactly one minimal, low-risk NUSA repository improvement as a git-compatible unified diff.",
    "Return JSON only with one field named patch.",
    "Modify exactly one .ts file under apps/autopilot/src.",
    "Do not modify index.ts, worker.ts, live/broker/order/credential/secret/withdraw/transfer surfaces, workflows, package files, or authority constants.",
    "Do not add dependencies or weaken tests, validation, safety, exact-head verification, dedupe, leases, or fail-closed behavior.",
    `Repository: ${request.repository}`,
    `Exact main SHA: ${request.headSha}`,
    `Workflow run: ${request.workflowRunId}`,
    `Execution reason: ${request.reason}`,
    `Execution id: ${request.executionId}`,
    `Dedupe key: ${request.dedupeKey}`,
  ].join("\n");
  return {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1",
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are NUSA's bounded cloud coding proposal engine. Obey every constraint and return JSON only." },
        { role: "user", content: userPrompt },
      ],
    }),
  };
}

export async function executeCodingRunner(
  request: CodingRunnerRequest,
  env: CodingRunnerEnv,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  runtime?: CodingRuntime,
  publisher?: CodingPublisher,
): Promise<CodingRunnerResult> {
  const githubToken = env.NUSA_GITHUB_TOKEN?.trim();
  if (!githubToken) return { status: "INTERFACE_READY", reason: "github-verification-not-configured" };
  await verifyCodingRunnerRequestAgainstGitHub(request, githubToken, fetchImpl);

  const endpoint = env.NUSA_AI_CODING_ENDPOINT?.trim();
  const token = env.NUSA_AI_CODING_TOKEN?.trim();
  const useConfiguredEngine = Boolean(endpoint && token);
  const response = useConfiguredEngine
    ? await fetchImpl(endpoint!, codingEngineRequest(request, token!))
    : await fetchImpl(GITHUB_MODELS_ENDPOINT, githubModelsCodingRequest(request, githubToken));
  if (!response.ok) return { status: "EXECUTION_FAILED", httpStatus: response.status, reason: useConfiguredEngine ? undefined : "github-models-coding-engine-failed" };

  if (runtime) {
    let proposal: CodingProposal;
    try {
      const payload = await response.json();
      proposal = useConfiguredEngine ? validateCodingProposal(payload) : githubModelsProposal(payload);
    } catch (error) {
      return { status: "EXECUTION_FAILED", reason: error instanceof Error ? error.message : "CODING_PROPOSAL_INVALID", httpStatus: response.status };
    }
    try {
      const runtimeResult = await runtime.execute(request, proposal);
      const safeRuntime = publicRuntimeResult(runtimeResult);
      if (!publisher) return { status: "EXECUTION_ACCEPTED", httpStatus: response.status, ...safeRuntime };
      if (!runtimeResult.proposalValidated || !runtimeResult.validatedFiles?.length) {
        return { status: "EXECUTION_FAILED", reason: "CODING_PUBLISH_VALIDATION_REQUIRED", httpStatus: response.status };
      }
      const published = await publisher.publish(request, runtimeResult);
      return { status: "EXECUTION_ACCEPTED", httpStatus: response.status, ...safeRuntime, ...published };
    } catch (error) {
      return { status: "EXECUTION_FAILED", reason: error instanceof Error ? error.message : "coding-runtime-failed", httpStatus: response.status };
    }
  }

  return { status: "EXECUTION_ACCEPTED", httpStatus: response.status };
}
