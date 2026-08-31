import { parseGithubWebhookPayload, planGithubWebhookDispatch, type SupportedGithubEvent } from "./dispatchPlanner";
import { planAutopilotExecution } from "./executionPlanner";
import { executeGithubDispatch } from "./githubExecutor";
import { verifyGithubActionsOidcToken, verifyGithubEventBridgeOidcToken } from "./githubActionsOidc";
import { executeCodingRunner, validateCodingRunnerRequest, type CodingPublisher, type CodingRuntime, type WorkersAiBinding } from "./codingRunner";
import { prepareProductionExecution } from "./productionExecutionSpine";
import {
  acquirePersistentExecution,
  markPersistentExecutionDispatched,
  recordAutopilotExecutionTelemetry,
  readAutopilotExecutionTelemetry,
  readCodingExecutionEvidence,
  recordCodingExecutionEvidence,
  releasePersistentExecution,
  readScheduledRuntimeEvidence,
  recordScheduledRuntimeReceipt,
  type ExecutionCoordinatorNamespace,
} from "./executionCoordinator";
import { runScheduledAutopilot } from "./scheduledRuntime";
import { createCodingExecutionEvidence } from "./codingExecutionEvidence";
import { classifyAutopilotFailure, createAutopilotExecutionTelemetry, type AutopilotExecutionTelemetryInput } from "./executionTelemetry";

export { ExecutionCoordinator } from "./executionCoordinator";

export interface Env {
  NUSA_WEBHOOK_SECRET?: string;
  NUSA_GITHUB_TOKEN?: string;
  NUSA_GITHUB_REPOSITORY?: string;
  NUSA_CODING_RUNNER_TOKEN?: string;
  NUSA_AI_CODING_ENDPOINT?: string;
  NUSA_AI_CODING_TOKEN?: string;
  NUSA_AI_CODING_MODEL?: string;
  AI?: WorkersAiBinding;
  NUSA_DEPLOYMENT_REVISION?: string;
  NUSA_EXECUTION_COORDINATOR?: ExecutionCoordinatorNamespace;
}

const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";
const CODING_EXECUTION_LEASE_MS = 20 * 60 * 1000;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const encoder = new TextEncoder();

async function persistCodingTelemetry(env: Env, input: AutopilotExecutionTelemetryInput): Promise<void> {
  if (!env.NUSA_EXECUTION_COORDINATOR) return;
  try {
    await recordAutopilotExecutionTelemetry(env.NUSA_EXECUTION_COORDINATOR, createAutopilotExecutionTelemetry(input));
  } catch (error) {
    console.error(JSON.stringify({ event: "NUSA_AUTOPILOT_TELEMETRY_PERSIST_FAILED", reason: error instanceof Error ? error.message : "UNKNOWN", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
  }
}

async function releaseCodingExecutionLease(env: Env, request: { readonly dedupeKey: string; readonly executionId: string }): Promise<void> {
  if (!env.NUSA_EXECUTION_COORDINATOR) return;
  try {
    await releasePersistentExecution(env.NUSA_EXECUTION_COORDINATOR, {
      dedupeKey: request.dedupeKey,
      executionId: request.executionId,
      now: Date.now(),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "NUSA_AUTOPILOT_LEASE_RELEASE_FAILED", reason: error instanceof Error ? error.message : "UNKNOWN", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
  }
}

export function classifyGithubEvent(value: string | null): SupportedGithubEvent | null {
  if (value === "ping" || value === "push" || value === "pull_request" || value === "workflow_run") return value;
  return null;
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
export async function computeGithubWebhookSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}
export async function verifyGithubWebhookSignature(secret: string, body: string, provided: string | null): Promise<boolean> {
  if (!provided?.startsWith("sha256=")) return false;
  return constantTimeEqual(await computeGithubWebhookSignature(secret, body), provided);
}

async function verifyGithubWebhookAuthorization(request: Request, env: Env, body: string, allowedRepository: string): Promise<boolean> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    try {
      await verifyGithubEventBridgeOidcToken(bearer, allowedRepository);
      return true;
    } catch {
      // Fall through to the legacy HMAC path when configured.
    }
  }
  const secret = env.NUSA_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return verifyGithubWebhookSignature(secret, body, request.headers.get("x-hub-signature-256"));
}

async function verifyCodingRunnerAuthorization(provided: string | undefined, configured: string | undefined, allowedRepository: string): Promise<boolean> {
  if (!provided) return false;
  if (configured && constantTimeEqual(configured, provided)) return true;
  try {
    await verifyGithubActionsOidcToken(provided, allowedRepository);
    return true;
  } catch {
    return false;
  }
}

export async function handleCodingExecute(
  request: Request,
  env: Env,
  runtime?: CodingRuntime,
  publisher?: CodingPublisher,
): Promise<Response> {
  const startedAt = Date.now();
  const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  const configured = env.NUSA_CODING_RUNNER_TOKEN?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!await verifyCodingRunnerAuthorization(provided, configured, allowedRepository)) return json({ error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
  try {
    const runnerRequest = validateCodingRunnerRequest(await request.json(), allowedRepository);
    if (!env.NUSA_EXECUTION_COORDINATOR) return json({ error: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", status: "INTERFACE_READY" }, 503);
    const lease = await acquirePersistentExecution(env.NUSA_EXECUTION_COORDINATOR, {
      dedupeKey: runnerRequest.dedupeKey,
      executionId: runnerRequest.executionId,
      now: startedAt,
      leaseExpiresAt: startedAt + CODING_EXECUTION_LEASE_MS,
    });
    if (!lease.acquired) {
      const duplicateReason = lease.reason ?? "DUPLICATE_EXECUTION";
      await persistCodingTelemetry(env, {
        executionId: runnerRequest.executionId,
        timestampMs: Date.now(),
        trigger: "repository_dispatch",
        decision: "dedupe-suppressed",
        action: "NO_ACTION",
        selectedExecutor: "cloud-coding-runner",
        dedupeKey: runnerRequest.dedupeKey,
        attempt: 1,
        retry: { attempt: 1, maxAttempts: 1, backoffMs: 0 },
        recovery: { action: "NONE", reason: duplicateReason },
        checkpoint: { checkpointId: null, resumed: false },
        durationMs: Math.max(0, Date.now() - startedAt),
        result: "DUPLICATE_EXECUTION_SUPPRESSED",
        validationResult: "PASSED",
        ciResult: "UNVERIFIED",
        failureClass: "deterministic",
        commitSha: null,
        pullRequestNumber: null,
        failureReason: duplicateReason,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
      return json({ accepted: true, status: "DUPLICATE_EXECUTION_SUPPRESSED", reason: duplicateReason, executionId: runnerRequest.executionId, dedupeKey: runnerRequest.dedupeKey, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 202);
    }

    let result: Awaited<ReturnType<typeof executeCodingRunner>>;
    try {
      result = await executeCodingRunner(runnerRequest, env, undefined, runtime, publisher);
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "CODING_RUNNER_EXECUTION_FAILED";
      await releaseCodingExecutionLease(env, runnerRequest);
      await persistCodingTelemetry(env, {
        executionId: runnerRequest.executionId,
        timestampMs: Date.now(),
        trigger: "repository_dispatch",
        decision: "coding-dispatch",
        action: "ACTION",
        selectedExecutor: "cloud-coding-runner",
        dedupeKey: runnerRequest.dedupeKey,
        attempt: 1,
        retry: { attempt: 1, maxAttempts: 1, backoffMs: 0 },
        recovery: { action: "NONE", reason: failureReason },
        checkpoint: { checkpointId: null, resumed: false },
        durationMs: Math.max(0, Date.now() - startedAt),
        result: "EXECUTION_FAILED",
        validationResult: "FAILED",
        ciResult: "UNVERIFIED",
        failureClass: classifyAutopilotFailure(failureReason),
        commitSha: null,
        pullRequestNumber: null,
        failureReason,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
      return json({ error: failureReason, status: "EXECUTION_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 400);
    }

    if (result.status === "EXECUTION_ACCEPTED") {
      await markPersistentExecutionDispatched(env.NUSA_EXECUTION_COORDINATOR, {
        dedupeKey: runnerRequest.dedupeKey,
        executionId: runnerRequest.executionId,
        now: Date.now(),
      });
    } else {
      await releaseCodingExecutionLease(env, runnerRequest);
    }
    const failureReason = result.reason ?? null;
    await persistCodingTelemetry(env, {
      executionId: runnerRequest.executionId,
      timestampMs: Date.now(),
      trigger: "repository_dispatch",
      decision: result.status === "EXECUTION_ACCEPTED" ? "coding-dispatch" : "coding-dispatch-failed",
      action: result.status === "EXECUTION_ACCEPTED" ? "ACTION" : "NO_ACTION",
      selectedExecutor: "cloud-coding-runner",
      dedupeKey: runnerRequest.dedupeKey,
      attempt: 1,
      retry: { attempt: 1, maxAttempts: 1, backoffMs: 0 },
      recovery: { action: "NONE", reason: failureReason },
      checkpoint: { checkpointId: result.checkpointId ?? null, resumed: false },
      durationMs: Math.max(0, Date.now() - startedAt),
      result: result.status,
      validationResult: result.proposalValidated === true || result.workspaceVerified === true ? "PASSED" : result.status === "EXECUTION_ACCEPTED" ? "NOT_RUN" : "FAILED",
      ciResult: "VERIFIED",
      failureClass: classifyAutopilotFailure(failureReason),
      commitSha: result.commitSha?.toLowerCase() ?? null,
      pullRequestNumber: result.pullRequestNumber ?? null,
      failureReason,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
    const evidenceDecision = createCodingExecutionEvidence(runnerRequest, result, Date.now());
    let evidencePersisted = false;
    if (evidenceDecision.status === "RECORDED" && env.NUSA_EXECUTION_COORDINATOR) {
      try {
        await recordCodingExecutionEvidence(env.NUSA_EXECUTION_COORDINATOR, evidenceDecision.evidence);
        evidencePersisted = true;
      } catch {
        console.error(JSON.stringify({ event: "NUSA_CODING_EVIDENCE_PERSIST_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
      }
    }
    return json({ accepted: true, ...result, executionEvidence: evidenceDecision.status === "RECORDED" ? evidenceDecision.evidence : null, executionEvidencePersisted: evidencePersisted, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, result.status === "EXECUTION_FAILED" ? 502 : 202);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "CODING_RUNNER_REQUEST_INVALID" }, 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
    if (request.method === "GET" && url.pathname === "/health") return json({ service: "nusa-autopilot", status: "WEBHOOK_READY", webhookAuthentication: env.NUSA_WEBHOOK_SECRET ? "OIDC_OR_HMAC" : "OIDC", deploymentRevision: env.NUSA_DEPLOYMENT_REVISION?.trim() || "UNVERIFIED", executionPlanning: "ENABLED", boundedExecutionSpine: "ENABLED", persistentExecutionCoordination: env.NUSA_EXECUTION_COORDINATOR ? "CONFIGURED" : "INTERFACE_READY", codingExecutionEvidence: env.NUSA_EXECUTION_COORDINATOR ? "CONFIGURED" : "INTERFACE_READY", executionTelemetry: env.NUSA_EXECUTION_COORDINATOR ? "CONFIGURED" : "INTERFACE_READY", authenticatedExecutor: env.NUSA_GITHUB_TOKEN ? "CONFIGURED" : "INTERFACE_READY", codingRunner: "OIDC_READY", legacyCodingRunnerToken: env.NUSA_CODING_RUNNER_TOKEN ? "CONFIGURED" : "NOT_REQUIRED", aiCodingEngine: (env.NUSA_AI_CODING_ENDPOINT && env.NUSA_AI_CODING_TOKEN) || env.AI ? "CONFIGURED" : "INTERFACE_READY", allowedRepository, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

    if (request.method === "GET" && url.pathname === "/scheduled/status") {
      if (!env.NUSA_EXECUTION_COORDINATOR) return json({ status: "UNAVAILABLE", reason: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      try {
        const evidence = await readScheduledRuntimeEvidence(env.NUSA_EXECUTION_COORDINATOR);
        return json({
          status: evidence.receipt ? "OBSERVED" : "AWAITING_FIRST_SCHEDULED_EVENT",
          deploymentRevision: env.NUSA_DEPLOYMENT_REVISION?.trim() || "UNVERIFIED",
          receipt: evidence.receipt,
          history: evidence.history,
          summary: evidence.summary,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        });
      } catch {
        return json({ status: "UNAVAILABLE", reason: "SCHEDULED_RUNTIME_RECEIPT_READ_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      }
    }

    if (request.method === "GET" && url.pathname === "/coding/evidence") {
      if (!env.NUSA_EXECUTION_COORDINATOR) return json({ status: "UNAVAILABLE", reason: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      try {
        const evidence = await readCodingExecutionEvidence(env.NUSA_EXECUTION_COORDINATOR);
        return json({ status: evidence.evidence ? "OBSERVED" : "AWAITING_FIRST_EXECUTION", ...evidence, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
      } catch {
        return json({ status: "UNAVAILABLE", reason: "CODING_EVIDENCE_READ_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      }
    }

    if (request.method === "GET" && url.pathname === "/coding/telemetry") {
      if (!env.NUSA_EXECUTION_COORDINATOR) return json({ status: "UNAVAILABLE", reason: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      try {
        const telemetry = await readAutopilotExecutionTelemetry(env.NUSA_EXECUTION_COORDINATOR);
        return json({ status: telemetry.telemetry ? "OBSERVED" : "AWAITING_FIRST_EXECUTION", ...telemetry, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
      } catch {
        return json({ status: "UNAVAILABLE", reason: "AUTOPILOT_TELEMETRY_READ_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/coding/execute") return handleCodingExecute(request, env);

    if (request.method !== "POST" || url.pathname !== "/github/webhook") return json({ error: "NOT_FOUND" }, 404);
    if (!env.NUSA_WEBHOOK_SECRET && !request.headers.get("authorization")?.trim()) return json({ error: "WEBHOOK_AUTH_NOT_PROVIDED", status: "INTERFACE_READY" }, 503);
    const deliveryId = request.headers.get("x-github-delivery");
    if (!deliveryId?.trim()) return json({ error: "GITHUB_DELIVERY_ID_REQUIRED" }, 400);
    const event = classifyGithubEvent(request.headers.get("x-github-event"));
    if (!event) return json({ error: "GITHUB_EVENT_UNSUPPORTED" }, 422);
    const body = await request.text();
    if (!await verifyGithubWebhookAuthorization(request, env, body, allowedRepository)) return json({ error: "GITHUB_WEBHOOK_UNAUTHORIZED" }, 401);
    let dispatch;
    try { dispatch = planGithubWebhookDispatch(event, parseGithubWebhookPayload(body)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "GITHUB_WEBHOOK_PAYLOAD_INVALID" }, 400); }

    const planned = planAutopilotExecution(dispatch);
    let execution = planned;
    let boundedExecution = null;
    try {
      boundedExecution = prepareProductionExecution(dispatch, {
        deliveryId,
        origin: "AUTO_BACKGROUND",
        now: Date.now(),
        allowedRepository,
      });
      if (dispatch.kind === "CI_SUCCEEDED") {
        if (!boundedExecution) throw new Error("PRODUCTION_EXECUTION_BOUNDARY_REQUIRED");
        if (!env.NUSA_EXECUTION_COORDINATOR) throw new Error("PERSISTENT_EXECUTION_COORDINATOR_REQUIRED");
        const lease = boundedExecution.state.lease;
        if (!lease) throw new Error("PERSISTENT_EXECUTION_LEASE_REQUIRED");
        const persistent = await acquirePersistentExecution(env.NUSA_EXECUTION_COORDINATOR, {
          dedupeKey: boundedExecution.envelope.dedupeKey,
          executionId: boundedExecution.envelope.executionId,
          now: Date.now(),
          leaseExpiresAt: lease.expiresAt,
        });
        if (!persistent.acquired) return json({ accepted: true, status: "DUPLICATE_EXECUTION_SUPPRESSED", reason: persistent.reason, deliveryId, event, dispatch, executionBoundary: { dedupeKey: boundedExecution.envelope.dedupeKey, origin: boundedExecution.envelope.origin }, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 202);
        execution = boundedExecution.request;
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "PRODUCTION_EXECUTION_INVALID", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 409);
    }

    const executor = await executeGithubDispatch(execution, { token: env.NUSA_GITHUB_TOKEN, allowedRepository });
    if (boundedExecution && executor.status === "DISPATCHED" && env.NUSA_EXECUTION_COORDINATOR) {
      await markPersistentExecutionDispatched(env.NUSA_EXECUTION_COORDINATOR, {
        dedupeKey: boundedExecution.envelope.dedupeKey,
        executionId: boundedExecution.envelope.executionId,
        now: Date.now(),
      });
    }
    return json({
      accepted: true,
      status: execution.kind === "NOOP" ? "NO_ACTION" : executor.status === "DISPATCHED" ? "EXECUTION_DISPATCHED" : "EXECUTION_REQUEST_PLANNED",
      deliveryId,
      event,
      dispatch,
      execution,
      executionBoundary: boundedExecution ? {
        cycleId: boundedExecution.envelope.cycleId,
        workItemId: boundedExecution.envelope.workItemId,
        executionId: boundedExecution.envelope.executionId,
        dedupeKey: boundedExecution.envelope.dedupeKey,
        origin: boundedExecution.envelope.origin,
        state: boundedExecution.state.status,
        leaseExpiresAt: boundedExecution.state.lease?.expiresAt ?? null,
        evidenceRefs: boundedExecution.envelope.evidenceRefs,
      } : null,
      executor,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 202);
  },

  async scheduled(controller: { scheduledTime?: number }, env: Env): Promise<void> {
    const scheduledTime = Number.isSafeInteger(controller?.scheduledTime) && Number(controller.scheduledTime) >= 0
      ? Number(controller.scheduledTime)
      : Date.now();
    const outcome = await runScheduledAutopilot(env, scheduledTime);
    if (env.NUSA_EXECUTION_COORDINATOR) {
      const observedAt = Math.max(Date.now(), scheduledTime);
      try {
        await recordScheduledRuntimeReceipt(env.NUSA_EXECUTION_COORDINATOR, {
          scheduledTime,
          observedAt,
          status: outcome.status,
          reason: outcome.reason,
          headSha: outcome.headSha,
          workflowRunId: outcome.workflowRunId,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "NUSA_SCHEDULED_RECEIPT_FAILED", reason: error instanceof Error ? error.message : "UNKNOWN" }));
      }
    }
    console.log(JSON.stringify({ event: "NUSA_SCHEDULED_AUTOPILOT", ...outcome }));
  },
};