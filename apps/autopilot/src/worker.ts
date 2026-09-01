import { Sandbox } from "@cloudflare/sandbox";
import baseWorker, { handleCodingExecute, type Env as BaseEnv } from "./index";
import { acquirePersistentExecution, ExecutionCoordinator, releasePersistentExecution } from "./executionCoordinator";
import { CloudflareSandboxBackend, type CloudflareSandboxNamespace } from "./cloudflareSandboxBackend";
import { GithubValidatedPatchPublisher } from "./githubValidatedPatchPublisher";
import { SandboxCodingRuntime } from "./sandboxCodingRuntime";
import { validateCodingExecutionEnvelope } from "./codingExecutionEnvelope";
import { validatePatchInSandbox } from "./sandboxPatchValidator";
import { verifyGithubActionsOidcToken } from "./githubActionsOidc";
import { executeOidcAuthorizedIndependentAudit, validateAuditRunnerRequest } from "./auditRunner";

export { Sandbox, ExecutionCoordinator };

interface WorkerEnv extends BaseEnv {
  Sandbox?: CloudflareSandboxNamespace;
  NUSA_AI_AUDIT_MODEL?: string;
}

const AUDIT_EXECUTION_LEASE_MS = 5 * 60 * 1000;
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

async function verifySandboxAuthorization(
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
    const result = await executeOidcAuthorizedIndependentAudit(auditRequest, env);
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
      if (!env.Sandbox) return json({ error: "CLOUDFLARE_SANDBOX_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);
      const runtime = new SandboxCodingRuntime(new CloudflareSandboxBackend(env.Sandbox));
      const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
      const publisher = new GithubValidatedPatchPublisher({ token: env.NUSA_GITHUB_TOKEN, allowedRepository });
      return handleCodingExecute(request, env, runtime, publisher);
    }

    if (request.method === "POST" && url.pathname === "/coding/sandbox/validate") {
      const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
      const configured = env.NUSA_CODING_RUNNER_TOKEN?.trim();
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!await verifySandboxAuthorization(provided, configured, allowedRepository)) {
        return json({ error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
      }
      if (!env.Sandbox) return json({ error: "CLOUDFLARE_SANDBOX_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);

      try {
        const body = await request.json() as { envelope?: unknown; patch?: unknown };
        const envelope = validateCodingExecutionEnvelope(body.envelope, allowedRepository);
        if (typeof body.patch !== "string") throw new Error("SANDBOX_PATCH_REQUIRED");
        const backend = new CloudflareSandboxBackend(env.Sandbox);
        const result = await validatePatchInSandbox(backend, { envelope, patch: body.patch });
        return json({
          accepted: true,
          status: result.status,
          backend: result.backend,
          changedFiles: result.changedFiles,
          checkpoint: result.checkpoint,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        }, 200);
      } catch (error) {
        return json({
          accepted: false,
          error: error instanceof Error ? error.message : "SANDBOX_PATCH_VALIDATION_FAILED",
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        }, 400);
      }
    }

    return baseWorker.fetch(request, env);
  },
  scheduled: baseWorker.scheduled,
};

export default worker;