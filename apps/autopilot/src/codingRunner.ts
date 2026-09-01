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
  NUSA_AI_CODING_MODEL?: string;
  NUSA_GITHUB_REPOSITORY?: string;
  NUSA_GITHUB_TOKEN?: string;
  AI?: WorkersAiBinding;
}

export interface WorkersAiJsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface WorkersAiResponseFormat {
  readonly type: "json_schema";
  readonly json_schema: WorkersAiJsonSchema;
}

export interface WorkersAiBinding {
  run(model: string, input: {
    prompt: string;
    response_format?: WorkersAiResponseFormat;
  }): Promise<unknown>;
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
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const RETIRED_WORKERS_AI_MODELS = new Set([
  "@cf/meta/infire-llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
]);

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
  if (!Object.prototype.hasOwnProperty.call(proposal, "patch") || proposal.patch === undefined || proposal.patch === null || (typeof proposal.patch === "string" && !proposal.patch.trim())) {
    throw new Error("CODING_PROPOSAL_PATCH_REQUIRED");
  }
  if (typeof proposal.patch !== "string") throw new Error("CODING_PROPOSAL_INVALID");
  return Object.freeze({ patch: proposal.patch });
}

function parseProposalText(value: string): CodingProposal {
  const text = value.trim();
  const fenced = (
    text.match(/^```(?:json|diff|patch)?\s*([\s\S]*?)\s*```$/i)
    ?? text.match(/```(?:json|diff|patch)?\s*([\s\S]*?)\s*```/i)
  )?.[1]?.trim();
  const candidate = fenced ?? text;

  // Workers AI occasionally emits the requested unified diff directly (or in a
  // ```diff fence) despite the JSON-only instruction. Treat that as the same
  // patch-only proposal contract; the sandbox still performs the authoritative
  // apply, scope, and safety validation before any publication.
  const diffStart = candidate.search(/^diff --git a\/[^\s]+ b\/[^\s]+(?:\r?\n|$)/m);
  if (diffStart >= 0) {
    const diff = candidate.slice(diffStart).replace(/\s*```\s*$/i, "").trim();
    if (/^\+\+\+ b\/[^\r\n]+$/m.test(diff)) return validateCodingProposal({ patch: diff });
  }

  // A patch string commonly contains TypeScript object literals. Track quoted
  // strings while balancing braces so those inner braces cannot truncate the
  // surrounding JSON object.
  const candidates = [candidate];
  for (let start = candidate.indexOf("{"); start >= 0; start = candidate.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        candidates.push(candidate.slice(start, index + 1));
        break;
      }
    }
  }
  let parsedJson = false;
  for (const json of candidates) {
    try {
      const parsed = JSON.parse(json);
      parsedJson = true;
      try {
        return validateCodingProposal(parsed);
      } catch (error) {
        if (error instanceof Error && error.message === "CODING_PROPOSAL_PATCH_REQUIRED") throw error;
        if (!(error instanceof Error) || error.message !== "CODING_PROPOSAL_INVALID") throw error;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "CODING_PROPOSAL_PATCH_REQUIRED") throw error;
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error(parsedJson ? "CODING_PROPOSAL_SHAPE_INVALID" : "CODING_PROPOSAL_JSON_INVALID");
}

function workersAiProposal(value: unknown): CodingProposal {
  const payload = object(value);
  if (typeof payload.response === "string") {
    if (!payload.response.trim()) throw new Error("CODING_PROPOSAL_RESPONSE_INVALID");
    return parseProposalText(payload.response);
  }
  // Workers AI JSON mode returns the schema object directly under `response`,
  // while non-JSON text mode returns a string. Validate both shapes without
  // accepting any unstructured or authority-bearing fields.
  if (payload.response && typeof payload.response === "object" && !Array.isArray(payload.response)) {
    try {
      return validateCodingProposal(payload.response);
    } catch (error) {
      if (error instanceof Error && error.message === "CODING_PROPOSAL_PATCH_REQUIRED") throw error;
      throw new Error("CODING_PROPOSAL_SHAPE_INVALID");
    }
  }
  throw new Error("CODING_PROPOSAL_RESPONSE_INVALID");
}

// A configured external coding engine is expected to return the patch-only contract directly
// ({ patch: string }), but many provider-neutral gateways instead wrap the model output in the
// same generic { response: string } envelope Workers AI uses. Fall back to that lenient,
// fence/JSON-extraction-aware parse so a wrapped-but-valid proposal is not rejected outright.
function configuredEngineProposal(value: unknown): CodingProposal {
  try {
    return validateCodingProposal(value);
  } catch (error) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).response === "string") {
      return workersAiProposal(value);
    }
    throw error;
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

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nusa-autopilot-worker",
  };
  const trimmed = token?.trim();
  if (trimmed) headers.Authorization = `Bearer ${trimmed}`;
  return headers;
}

async function githubEvidenceGet(url: string, githubToken: string | undefined, fetchImpl: FetchImpl): Promise<HttpResponse> {
  const token = githubToken?.trim();
  const first = await fetchImpl(url, { method: "GET", headers: githubHeaders(token) });
  if (!token || (first.status !== 401 && first.status !== 403 && first.status !== 404)) return first;
  return fetchImpl(url, { method: "GET", headers: githubHeaders() });
}

export async function verifyCodingRunnerRequestAgainstGitHub(
  request: CodingRunnerRequest,
  githubToken: string | undefined,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<void> {
  const repository = request.repository.split("/").map(encodeURIComponent).join("/");

  const commitResponse = await githubEvidenceGet(`${GITHUB_API_ORIGIN}/repos/${repository}/commits/${request.headSha}`, githubToken, fetchImpl);
  if (commitResponse.status !== 200) throw new Error("CODING_RUNNER_HEAD_SHA_UNVERIFIED");
  const commit = object(await commitResponse.json());
  if (typeof commit.sha !== "string" || commit.sha.toLowerCase() !== request.headSha.toLowerCase()) throw new Error("CODING_RUNNER_HEAD_SHA_MISMATCH");

  const runResponse = await githubEvidenceGet(`${GITHUB_API_ORIGIN}/repos/${repository}/actions/runs/${request.workflowRunId}`, githubToken, fetchImpl);
  if (runResponse.status !== 200) throw new Error("CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED");
  const run = object(await runResponse.json());
  const runRepository = object(run.repository);
  if (run.id !== request.workflowRunId) throw new Error("CODING_RUNNER_WORKFLOW_RUN_ID_MISMATCH");
  if (typeof run.head_sha !== "string" || run.head_sha.toLowerCase() !== request.headSha.toLowerCase()) throw new Error("CODING_RUNNER_WORKFLOW_HEAD_MISMATCH");
  if (runRepository.full_name !== request.repository) throw new Error("CODING_RUNNER_WORKFLOW_REPOSITORY_MISMATCH");
  if (run.status !== "completed") throw new Error("CODING_RUNNER_WORKFLOW_NOT_COMPLETED");
  const failureRepair = request.reason.includes("gha:");
  const allowedConclusions = failureRepair ? ["failure", "cancelled", "timed_out"] : ["success"];
  if (typeof run.conclusion !== "string" || !allowedConclusions.includes(run.conclusion)) {
    throw new Error(failureRepair ? "CODING_RUNNER_FAILURE_EVIDENCE_INVALID" : "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL");
  }
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

function codingProposalPrompt(request: CodingRunnerRequest): string {
  return [
    "Propose exactly one minimal, low-risk NUSA repository improvement as a git-compatible unified diff.",
    "Return JSON only with one field named patch.",
    "Do not use Markdown fences or explanatory text around the JSON.",
    "The patch must contain exactly one diff --git header and exactly one +++ b/apps/autopilot/src/<file>.ts path; do not include any other file.",
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
}

function workersAiCodingRequest(request: CodingRunnerRequest, model: string, prompt = codingProposalPrompt(request)): {
  model: string;
  prompt: string;
  response_format: {
    type: "json_schema";
    json_schema: {
      type: "object";
      properties: { patch: { type: "string" } };
      required: readonly ["patch"];
      additionalProperties: false;
    };
  };
} {
  return {
    model,
    prompt,
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: { patch: { type: "string" } },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  };
}

const MAX_WORKERS_AI_PROPOSAL_ATTEMPTS = 3;

function retryableProposalFailure(reason: string): boolean {
  return reason.startsWith("CODING_PROPOSAL_") || reason.startsWith("SANDBOX_PATCH_");
}

function validWorkersAiModel(value: string): boolean {
  return /^[A-Za-z0-9@._/-]{1,128}$/.test(value);
}

async function executeProposal(
  request: CodingRunnerRequest,
  proposal: CodingProposal,
  runtime: CodingRuntime | undefined,
  publisher: CodingPublisher | undefined,
  httpStatus?: number,
): Promise<CodingRunnerResult> {
  const status = httpStatus === undefined ? {} : { httpStatus };
  if (!runtime) return { status: "EXECUTION_ACCEPTED", ...status };
  try {
    const runtimeResult = await runtime.execute(request, proposal);
    const safeRuntime = publicRuntimeResult(runtimeResult);
    if (!publisher) return { status: "EXECUTION_ACCEPTED", ...status, ...safeRuntime };
    if (!runtimeResult.proposalValidated || !runtimeResult.validatedFiles?.length) {
      return { status: "EXECUTION_FAILED", reason: "CODING_PUBLISH_VALIDATION_REQUIRED", ...status };
    }
    const published = await publisher.publish(request, runtimeResult);
    return { status: "EXECUTION_ACCEPTED", ...status, ...safeRuntime, ...published };
  } catch (error) {
    return { status: "EXECUTION_FAILED", reason: error instanceof Error ? error.message : "coding-runtime-failed", ...status };
  }
}

export async function executeCodingRunner(
  request: CodingRunnerRequest,
  env: CodingRunnerEnv,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  runtime?: CodingRuntime,
  publisher?: CodingPublisher,
): Promise<CodingRunnerResult> {
  await verifyCodingRunnerRequestAgainstGitHub(request, env.NUSA_GITHUB_TOKEN, fetchImpl);

  const endpoint = env.NUSA_AI_CODING_ENDPOINT?.trim();
  const token = env.NUSA_AI_CODING_TOKEN?.trim();
  // Prefer the binding-backed Workers AI path whenever it is available. A stale or retired
  // configured endpoint must not shadow the canonical Worker AI binding in production.
  const useConfiguredEngine = Boolean(endpoint && token && !env.AI);
  if (useConfiguredEngine) {
    const response = await fetchImpl(endpoint!, codingEngineRequest(request, token!));
    if (!response.ok) return { status: "EXECUTION_FAILED", httpStatus: response.status, reason: "coding-engine-request-failed" };
    if (!runtime) return { status: "EXECUTION_ACCEPTED", httpStatus: response.status };
    try {
      return await executeProposal(request, configuredEngineProposal(await response.json()), runtime, publisher, response.status);
    } catch (error) {
      return { status: "EXECUTION_FAILED", reason: error instanceof Error ? error.message : "CODING_PROPOSAL_INVALID", httpStatus: response.status };
    }
  }

  if (!env.AI) return { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" };
  const configuredModel = env.NUSA_AI_CODING_MODEL?.trim();
  // Dashboard vars can outlive a provider retirement; never call a known-retired model.
  const model = !configuredModel || RETIRED_WORKERS_AI_MODELS.has(configuredModel)
    ? DEFAULT_WORKERS_AI_MODEL
    : configuredModel;
  if (!validWorkersAiModel(model)) return { status: "EXECUTION_FAILED", reason: "WORKERS_AI_MODEL_INVALID" };
  let prompt = codingProposalPrompt(request);
  let lastFailure: CodingRunnerResult | undefined;
  for (let attempt = 1; attempt <= MAX_WORKERS_AI_PROPOSAL_ATTEMPTS; attempt += 1) {
    try {
      const proposal = workersAiProposal(await env.AI.run(model, workersAiCodingRequest(request, model, prompt)));
      const result = await executeProposal(request, proposal, runtime, publisher);
      if (result.status === "EXECUTION_ACCEPTED" || !retryableProposalFailure(result.reason ?? "") || attempt === MAX_WORKERS_AI_PROPOSAL_ATTEMPTS) {
        return result;
      }
      lastFailure = result;
      prompt = `${codingProposalPrompt(request)}\nThe previous proposal was rejected by the bounded patch contract (${result.reason}). Return a new valid one-file unified diff only.`;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "WORKERS_AI_CODING_ENGINE_FAILED";
      if (!retryableProposalFailure(reason) || attempt === MAX_WORKERS_AI_PROPOSAL_ATTEMPTS) {
        return { status: "EXECUTION_FAILED", reason };
      }
      prompt = `${codingProposalPrompt(request)}\nThe previous proposal was rejected by the bounded proposal contract (${reason}). Return a new valid one-file unified diff only.`;
    }
  }
  return lastFailure ?? { status: "EXECUTION_FAILED", reason: "WORKERS_AI_CODING_ENGINE_FAILED" };
}
