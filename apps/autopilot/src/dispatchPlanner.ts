export type SupportedGithubEvent = "ping" | "push" | "pull_request" | "workflow_run";

export type AutopilotDispatchKind =
  | "PING_ACK"
  | "MAIN_PUSH"
  | "PR_CHANGED"
  | "CI_SUCCEEDED"
  | "CI_FAILED"
  | "IGNORED";

export interface AutopilotDispatchPlan {
  readonly kind: AutopilotDispatchKind;
  readonly repository: string | null;
  readonly headSha: string | null;
  readonly prNumber: number | null;
  readonly workflowRunId: number | null;
  readonly reason: string;
  readonly mutationAllowed: false;
}

type JsonObject = Record<string, unknown>;

const CANONICAL_CI_WORKFLOW = "CI";
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

function repositoryName(payload: JsonObject): string | null {
  return text(object(payload.repository)?.full_name);
}

function ignored(payload: JsonObject, reason: string): AutopilotDispatchPlan {
  return freeze({ kind: "IGNORED", repository: repositoryName(payload), headSha: null, prNumber: null, workflowRunId: null, reason, mutationAllowed: false });
}

export function parseGithubWebhookPayload(body: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("GITHUB_WEBHOOK_JSON_INVALID");
  }
  const payload = object(parsed);
  if (!payload) throw new Error("GITHUB_WEBHOOK_PAYLOAD_INVALID");
  return payload;
}

export function planGithubWebhookDispatch(event: SupportedGithubEvent, payload: JsonObject): AutopilotDispatchPlan {
  const repository = repositoryName(payload);
  if (event === "ping") {
    return freeze({ kind: "PING_ACK", repository, headSha: null, prNumber: null, workflowRunId: null, reason: "webhook-connectivity-verified", mutationAllowed: false });
  }

  if (event === "push") {
    if (text(payload.ref) !== "refs/heads/main") return ignored(payload, "non-main-push");
    const headSha = text(payload.after);
    if (!headSha) return ignored(payload, "main-push-missing-head");
    return freeze({ kind: "MAIN_PUSH", repository, headSha, prNumber: null, workflowRunId: null, reason: "main-changed", mutationAllowed: false });
  }

  if (event === "pull_request") {
    const action = text(payload.action);
    const pr = object(payload.pull_request);
    const prNumber = positiveInteger(payload.number);
    const headSha = text(object(pr?.head)?.sha);
    const allowed = new Set(["opened", "reopened", "synchronize", "ready_for_review", "closed"]);
    if (!action || !allowed.has(action) || !pr || !prNumber || !headSha) return ignored(payload, "pull-request-event-not-actionable");
    return freeze({ kind: "PR_CHANGED", repository, headSha, prNumber, workflowRunId: null, reason: `pull-request:${action}`, mutationAllowed: false });
  }

  const action = text(payload.action);
  const run = object(payload.workflow_run);
  const workflowRunId = positiveInteger(run?.id);
  const headSha = text(run?.head_sha);
  const status = text(run?.status);
  const conclusion = text(run?.conclusion);
  const workflowName = text(run?.name);
  if (action !== "completed" || !run || !workflowRunId || !headSha || status !== "completed") return ignored(payload, "workflow-run-not-completed");

  // repository_dispatch is the output edge of this autopilot. Dispatching again when the
  // consumer workflow completes would create a self-amplifying workflow_run -> dispatch loop.
  if (text(run.event) === "repository_dispatch") return ignored(payload, "workflow-run-originated-from-repository-dispatch");

  if (conclusion === "success") {
    // A single commit can complete several successful workflows. Only the canonical full CI
    // workflow may advance the development loop; auxiliary evidence/workflows remain signals,
    // not duplicate execution edges for the same head SHA.
    if (workflowName !== CANONICAL_CI_WORKFLOW) return ignored(payload, "workflow-run-success-not-canonical-ci");
    return freeze({ kind: "CI_SUCCEEDED", repository, headSha, prNumber: null, workflowRunId, reason: "workflow-run-success", mutationAllowed: false });
  }
  if (["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"].includes(conclusion ?? "")) {
    return freeze({ kind: "CI_FAILED", repository, headSha, prNumber: null, workflowRunId, reason: `workflow-run:${conclusion}`, mutationAllowed: false });
  }
  return ignored(payload, `workflow-run-conclusion:${conclusion ?? "unknown"}`);
}
