import { parseGithubWebhookPayload, planGithubWebhookDispatch, type SupportedGithubEvent } from "./dispatchPlanner";
import { planAutopilotExecution } from "./executionPlanner";
import { executeGithubDispatch } from "./githubExecutor";

export interface Env {
  NUSA_WEBHOOK_SECRET?: string;
  NUSA_GITHUB_TOKEN?: string;
  NUSA_GITHUB_REPOSITORY?: string;
}

const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

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
  const expected = await computeGithubWebhookSignature(secret, body);
  return constantTimeEqual(expected, provided);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "nusa-autopilot",
        status: env.NUSA_WEBHOOK_SECRET ? "WEBHOOK_READY" : "INTERFACE_READY",
        executionPlanning: "ENABLED",
        authenticatedExecutor: env.NUSA_GITHUB_TOKEN ? "CONFIGURED" : "INTERFACE_READY",
        allowedRepository,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
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
    try {
      dispatch = planGithubWebhookDispatch(event, parseGithubWebhookPayload(body));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "GITHUB_WEBHOOK_PAYLOAD_INVALID" }, 400);
    }

    const execution = planAutopilotExecution(dispatch);
    const executor = await executeGithubDispatch(execution, {
      token: env.NUSA_GITHUB_TOKEN,
      allowedRepository,
    });
    return json({
      accepted: true,
      status: execution.kind === "NOOP" ? "NO_ACTION" : executor.status === "DISPATCHED" ? "EXECUTION_DISPATCHED" : "EXECUTION_REQUEST_PLANNED",
      deliveryId,
      event,
      dispatch,
      execution,
      executor,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }, 202);
  },
};
