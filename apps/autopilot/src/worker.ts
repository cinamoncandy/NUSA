import baseWorker, { handleCodingExecute, type Env as BaseEnv } from "./index";
import { acquirePersistentExecution, ExecutionCoordinator, releasePersistentExecution } from "./executionCoordinator";
import {
  executeCodingRunner,
  validateCodingRunnerRequest,
  verifyCodingRunnerRequestAgainstGitHub,
  type CodingProposal,
  type CodingRuntime,
  type CodingRuntimeExecutionResult,
  type CodingRunnerRequest,
} from "./codingRunner";
import { GithubValidatedPatchPublisher } from "./githubValidatedPatchPublisher";
import { verifyGithubActionsOidcToken } from "./githubActionsOidc";
import { executeIndependentAudit, validateAuditRunnerRequest } from "./auditRunner";

export { ExecutionCoordinator };

interface WorkerEnv extends BaseEnv {
  NUSA_AI_AUDIT_MODEL?: string;
}

const AUDIT_EXECUTION_LEASE_MS = 5 * 60 * 1000;
const MAX_VALIDATED_FILE_BYTES = 128_000;
const SAFE_AUTOPILOT_PATH = /^apps\/autopilot\/[A-Za-z0-9._/-]+$/;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function verifyCodingAuthorization(
  provided: string | undefined,
  configured: string | undefined,
  allowedRepository: string,
): Promise<boolean> {
  if (!provided) return false;
  if (configured && constantTimeEqual(configured, provided)) return true;
  try {
    await verifyGithubActionsOidcToken(provided, allowedRepository);
    return true;
  } catch {
    return false;
  }
}

async function verifyAuditAuthorization(provided: string | undefined, allowedRepository: string): Promise<boolean> {
  if (!provided) return false;
  try {
    await verifyGithubActionsOidcToken(provided, allowedRepository);
    return true;
  } catch {
    return false;
  }
}

class ProposalCaptureRuntime implements CodingRuntime {
  readonly name = "github-actions-proposal";
  proposal?: CodingProposal;

  async execute(request: CodingRunnerRequest, proposal?: CodingProposal): Promise<CodingRuntimeExecutionResult> {
    if (!proposal?.patch.trim()) throw new Error("CODING_PROPOSAL_PATCH_REQUIRED");
    this.proposal = proposal;
    return Object.freeze({
      backend: this.name,
      checkpointId: request.headSha,
      workspaceVerified: true as const,
    });
  }
}

function validatePublishedFiles(value: unknown): readonly { readonly path: string; readonly content: string }[] {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("CODING_PUBLISH_FILE_COUNT_INVALID");
  const file = value[0];
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("CODING_PUBLISH_FILE_INVALID");
  const record = file as Record<string, unknown>;
  const path = record.path;
  const content = record.content;
  if (typeof path !== "string" || !SAFE_AUTOPILOT_PATH.test(path) || path.includes("..")) {
    throw new Error("CODING_PUBLISH_PATH_INVALID");
  }
  if (path === "apps/autopilot/src/index.ts" || path === "apps/autopilot/src/worker.ts") {
    throw new Error("CODING_PUBLISH_AUTHORITY_SURFACE_FORBIDDEN");
  }
  if (typeof content !== "string" || new TextEncoder().encode(content).byteLength > MAX_VALIDATED_FILE_BYTES) {
    throw new Error("CODING_PUBLISH_CONTENT_INVALID");
  }
  return Object.freeze([Object.freeze({ path, content })]);
}

async function handleCodingProposal(request: Request, env: WorkerEnv): Promise<Response> {
  const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!await verifyCodingAuthorization(provided, env.NUSA_CODING_RUNNER_TOKEN?.trim(), allowedRepository)) {
    return json({ accepted: false, status: "CODING_PROPOSAL_FAILED_CLOSED", error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
  }

  try {
    const runnerRequest = validateCodingRunnerRequest(await request.json(), allowedRepository);
    const capture = new ProposalCaptureRuntime();
    const result = await executeCodingRunner(runnerRequest, env, undefined, capture);
    if (result.status !== "EXECUTION_ACCEPTED" || !capture.proposal?.patch.trim()) {
      throw new Error(result.reason || "CODING_PROPOSAL_UNAVAILABLE");
    }
    return json({
      accepted: true,
      status: "PROPOSAL_READY",
      patch: capture.proposal.patch,
      headSha: runnerRequest.headSha,
      workflowRunId: runnerRequest.workflowRunId,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  } catch (error) {
    return json({
      accepted: false,
      status: "CODING_PROPOSAL_FAILED_CLOSED",
      error: error instanceof Error ? error.message : "CODING_PROPOSAL_FAILED",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 409);
  }
}

async function handleCodingPublish(request: Request, env: WorkerEnv): Promise<Response> {
  const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!await verifyCodingAuthorization(provided, env.NUSA_CODING_RUNNER_TOKEN?.trim(), allowedRepository)) {
    return json({ accepted: false, status: "CODING_PUBLISH_FAILED_CLOSED", error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
  }

  try {
    const body = await request.json() as { request?: unknown; validatedFiles?: unknown };
    const runnerRequest = validateCodingRunnerRequest(body.request, allowedRepository);
    await verifyCodingRunnerRequestAgainstGitHub(runnerRequest, env.NUSA_GITHUB_TOKEN);
    const validatedFiles = validatePublishedFiles(body.validatedFiles);
    const runtime: CodingRuntimeExecutionResult = Object.freeze({
      backend: "github-actions-runner",
      checkpointId: runnerRequest.headSha,
      workspaceVerified: true,
      proposalValidated: true,
      changedFiles: Object.freeze(validatedFiles.map((file) => file.path)),
      validatedFiles,
    });
    const publisher = new GithubValidatedPatchPublisher({ token: env.NUSA_GITHUB_TOKEN, allowedRepository });
    const published = await publisher.publish(runnerRequest, runtime);
    return json({
      accepted: true,
      status: "EXECUTION_ACCEPTED",
      backend: runtime.backend,
      checkpointId: runtime.checkpointId,
      workspaceVerified: true,
      proposalValidated: true,
      changedFiles: runtime.changedFiles,
      ...published,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  } catch (error) {
    return json({
      accepted: false,
      status: "CODING_PUBLISH_FAILED_CLOSED",
      error: error instanceof Error ? error.message : "CODING_PUBLISH_FAILED",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 409);
  }
}

async function handleAuditExecute(request: Request, env: WorkerEnv): Promise<Response> {
  const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!await verifyAuditAuthorization(provided, allowedRepository)) {
    return json({ accepted: false, status: "AUDIT_FAILED_CLOSED", error: "AUDIT_RUNNER_UNAUTHORIZED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 401);
  }
  if (!env.NUSA_EXECUTION_COORDINATOR) {
    return json({ accepted: false, status: "AUDIT_FAILED_CLOSED", error: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
  }

  let auditRequest;
  try {
    auditRequest = validateAuditRunnerRequest(await request.json(), allowedRepository);
  } catch (error) {
    return json({ accepted: false, status: "AUDIT_FAILED_CLOSED", error: error instanceof Error ? error.message : "AUDIT_RUNNER_REQUEST_INVALID", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 400);
  }

  const startedAt = Date.now();
  const lease = await acquirePersistentExecution(env.NUSA_EXECUTION_COORDINATOR, {
    dedupeKey: auditRequest.dedupeKey,
    executionId: auditRequest.executionId,
    now: startedAt,
    leaseExpiresAt: startedAt + AUDIT_EXECUTION_LEASE_MS,
  });
  if (!lease.acquired) {
    return json({
      accepted: false,
      status: "DUPLICATE_AUDIT_REQUEST",
      reason: lease.reason ?? "DUPLICATE_EXECUTION",
      executionId: auditRequest.executionId,
      dedupeKey: auditRequest.dedupeKey,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 409);
  }

  try {
    const result = await executeIndependentAudit(auditRequest, env);
    return json({ accepted: true, ...result }, 200);
  } catch (error) {
    return json({
      accepted: false,
      status: "AUDIT_FAILED_CLOSED",
      error: error instanceof Error ? error.message : "AUDIT_EXECUTION_FAILED",
      reviewedHeadSha: auditRequest.headSha,
      baseSha: auditRequest.baseSha,
      workflowRunId: auditRequest.workflowRunId,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 409);
  } finally {
    try {
      await releasePersistentExecution(env.NUSA_EXECUTION_COORDINATOR, {
        dedupeKey: auditRequest.dedupeKey,
        executionId: auditRequest.executionId,
        now: Date.now(),
      });
    } catch {
      console.error(JSON.stringify({ event: "NUSA_AUDIT_LEASE_RELEASE_FAILED", executionId: auditRequest.executionId, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
    }
  }
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/audit/execute") {
      return handleAuditExecute(request, env);
    }

    if (request.method === "POST" && url.pathname === "/coding/execute") {
      return handleCodingExecute(request, env);
    }

    if (request.method === "POST" && url.pathname === "/coding/propose") {
      return handleCodingProposal(request, env);
    }

    if (request.method === "POST" && url.pathname === "/coding/publish") {
      return handleCodingPublish(request, env);
    }

    if (request.method === "POST" && url.pathname === "/coding/sandbox/validate") {
      return json({
        accepted: false,
        status: "CONTAINER_RUNTIME_RETIRED",
        error: "GITHUB_ACTIONS_VALIDATION_REQUIRED",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      }, 410);
    }

    return baseWorker.fetch(request, env);
  },
  scheduled: baseWorker.scheduled,
};

export default worker;
