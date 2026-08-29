import { parseGithubWebhookPayload, planGithubWebhookDispatch, type SupportedGithubEvent } from "./dispatchPlanner";
import { planAutopilotExecution } from "./executionPlanner";
import { executeGithubDispatch } from "./githubExecutor";
import { executeCodingRunner, validateCodingRunnerRequest } from "./codingRunner";
import { prepareProductionExecution } from "./productionExecutionSpine";
import {
  acquirePersistentExecution,
  markPersistentExecutionDispatched,
  readScheduledRuntimeReceipt,
  recordScheduledRuntimeReceipt,
  type ExecutionCoordinatorNamespace,
} from "./executionCoordinator";
import { runScheduledAutopilot } from "./scheduledRuntime";

export { ExecutionCoordinator } from "./executionCoordinator";

export interface Env {
  NUSA_WEBHOOK_SECRET?: string;
  NUSA_GITHUB_TOKEN?: string;
  NUSA_GITHUB_REPOSITORY?: string;
  NUSA_CODING_RUNNER_TOKEN?: string;
  NUSA_AI_CODING_ENDPOINT?: string;
  NUSA_AI_CODING_TOKEN?: string;
  NUSA_DEPLOYMENT_REVISION?: string;
  NUSA_EXECUTION_COORDINATOR?: ExecutionCoordinatorNamespace;
}

const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const encoder = new TextEncoder();

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
    if (request.method === "GET" && url.pathname === "/health") return json({ service: "nusa-autopilot", status: env.NUSA_WEBHOOK_SECRET ? "WEBHOOK_READY" : "INTERFACE_READY", deploymentRevision: env.NUSA_DEPLOYMENT_REVISION?.trim() || "UNVERIFIED", executionPlanning: "ENABLED", boundedExecutionSpine: "ENABLED", persistentExecutionCoordination: env.NUSA_EXECUTION_COORDINATOR ? "CONFIGURED" : "INTERFACE_READY", authenticatedExecutor: env.NUSA_GITHUB_TOKEN ? "CONFIGURED" : "INTERFACE_READY", codingRunner: env.NUSA_CODING_RUNNER_TOKEN ? "CONFIGURED" : "INTERFACE_READY", aiCodingEngine: env.NUSA_AI_CODING_ENDPOINT && env.NUSA_AI_CODING_TOKEN ? "CONFIGURED" : "INTERFACE_READY", allowedRepository, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

    if (request.method === "GET" && url.pathname === "/scheduled/status") {
      if (!env.NUSA_EXECUTION_COORDINATOR) return json({ status: "UNAVAILABLE", reason: "PERSISTENT_EXECUTION_COORDINATOR_REQUIRED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      try {
        const receipt = await readScheduledRuntimeReceipt(env.NUSA_EXECUTION_COORDINATOR);
        return json({
          status: receipt ? "OBSERVED" : "AWAITING_FIRST_SCHEDULED_EVENT",
          deploymentRevision: env.NUSA_DEPLOYMENT_REVISION?.trim() || "UNVERIFIED",
          receipt,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        });
      } catch {
        return json({ status: "UNAVAILABLE", reason: "SCHEDULED_RUNTIME_RECEIPT_READ_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/coding/execute") {
      const configured = env.NUSA_CODING_RUNNER_TOKEN?.trim();
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!configured) return json({ error: "CODING_RUNNER_TOKEN_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);
      if (!provided || !constantTimeEqual(configured, provided)) return json({ error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
      try {
        const runnerRequest = validateCodingRunnerRequest(await request.json(), allowedRepository);
        const result = await executeCodingRunner(runnerRequest, env);
        return json({ accepted: true, ...result, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }, result.status === "EXECUTION_FAILED" ? 502 : 202);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "CODING_RUNNER_REQUEST_INVALID" }, 400);
      }
    }

    if (request.method !== "POST" || url.pathname !== "/github/webhook") return json({ error: "NOT_FOUND" }, 404);
    if (!env.NUSA_WEBHOOK_SECRET) return json({ error: "WEBHOOK_SECRET_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);
    const deliveryId = request.headers.get("x-github-delivery");
    if (!deliveryId?.trim()) return json({ error: "GITHUB_DELIVERY_ID_REQUIRED" }, 400);
    const event = classifyGithubEvent(request.headers.get("x-github-event"));
    if (!event) return json({ error: "GITHUB_EVENT_UNSUPPORTED" }, 422);
    const body = await request.text();
    if (!await verifyGithubWebhookSignature(env.NUSA_WEBHOOK_SECRET, body, request.headers.get("x-hub-signature-256"))) return json({ error: "GITHUB_SIGNATURE_INVALID" }, 401);
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
    const scheduledTime = Number.isSafeInteger(controller?.scheduledTime) && Number(controller?.scheduledTime) >= 0
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
