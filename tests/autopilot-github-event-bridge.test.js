import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createDeliveryId, createGithubSignature, dispatchGithubEvent, isAuditFallbackEligible } from "../scripts/dispatch-github-event-to-autopilot.mjs";

const workflow = fs.readFileSync(path.resolve(".github", "workflows", "autopilot-github-event-bridge.yml"), "utf8");
const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: "cinamoncandy/NUSA" } }));
const safetyPayload = (extra = {}) => ({
  accepted: true,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  executor: { status: "NOOP", reason: "no-action", httpStatus: null },
  ...extra,
});
const safetyResponse = (extra = {}) => new Response(JSON.stringify(safetyPayload(extra)), { status: 202, headers: { "content-type": "application/json" } });

test("the event bridge uses one deterministic delivery identity and exact HMAC bytes", () => {
  const first = createDeliveryId({ repository: "cinamoncandy/NUSA", event: "push", runId: "10", runAttempt: "2" });
  const second = createDeliveryId({ repository: "cinamoncandy/NUSA", event: "push", runId: "10", runAttempt: "2" });
  assert.equal(first, second);
  assert.equal(createGithubSignature("bridge-test-secret", body), `sha256=${crypto.createHmac("sha256", "bridge-test-secret").update(body).digest("hex")}`);
});

test("missing OIDC and repository secret fails closed without making a request", async () => {
  let calls = 0;
  await assert.rejects(() => dispatchGithubEvent({ secret: "", body, event: "push", repository: "cinamoncandy/NUSA", runId: "11", runAttempt: "1", fetchImpl: async () => { calls += 1; return safetyResponse(); } }), /WEBHOOK_AUTH_REQUIRED/);
  assert.equal(calls, 0);
});

test("pull_request_target is delivered as the canonical pull_request event", async () => {
  let request;
  const result = await dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "pull_request_target", repository: "cinamoncandy/NUSA", runId: "12", runAttempt: "1", webhookUrl: "https://autopilot.example.test/github/webhook", fetchImpl: async (url, init) => { request = { url, init }; return safetyResponse(); }, timeoutMs: 100 });
  assert.equal(result.status, "DELIVERED");
  assert.equal(result.auditFallbackEligible, false);
  assert.equal(result.executorStatus, "NOOP");
  assert.equal(request.url, "https://autopilot.example.test/github/webhook");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["x-github-event"], "pull_request");
  assert.equal(request.init.headers["x-github-delivery"], result.deliveryId);
  assert.equal(Buffer.from(request.init.body).toString(), body.toString());
  assert.equal(request.init.headers["x-hub-signature-256"], createGithubSignature("bridge-test-secret", body));
});

test("Audit fallback eligibility is limited to explicit credential failures on AUDIT_REQUEST", async () => {
  const tokenMissing = safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "INTERFACE_READY", reason: "github-executor-token-not-configured", httpStatus: null } });
  const authRejected = safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "FAILED", reason: "github-executor-auth-rejected", httpStatus: 403 } });
  const dispatchScopeInvalid = safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "FAILED", reason: "github-executor-repository-or-token-scope-invalid", httpStatus: 404 } });
  const prScopeInvalid = safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "FAILED", reason: "github-executor-pr-or-token-scope-invalid", httpStatus: 404 } });
  assert.equal(isAuditFallbackEligible(tokenMissing), true);
  assert.equal(isAuditFallbackEligible(authRejected), true);
  assert.equal(isAuditFallbackEligible(dispatchScopeInvalid), true);
  assert.equal(isAuditFallbackEligible(prScopeInvalid), true);
  assert.equal(isAuditFallbackEligible({ ...authRejected, execution: { kind: "REPOSITORY_AUTOPILOT" } }), false);
  assert.equal(isAuditFallbackEligible(safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "REJECTED", reason: "github-executor-stale-pr-head-suppressed", httpStatus: null } })), false);
  assert.equal(isAuditFallbackEligible(safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "FAILED", reason: "github-executor-http-500", httpStatus: 500 } })), false);
  const result = await dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "16", runAttempt: "1", fetchImpl: async () => new Response(JSON.stringify(authRejected), { status: 202 }), timeoutMs: 100 });
  assert.equal(result.auditFallbackEligible, true);
  assert.equal(result.executorStatus, "FAILED");
  assert.equal(result.executorReason, "github-executor-auth-rejected");
  assert.equal(result.executorHttpStatus, 403);
});

test("transient delivery failures retry once while authentication failures fail closed", async () => {
  let calls = 0;
  const retried = await dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "13", runAttempt: "1", fetchImpl: async () => { calls += 1; return calls === 1 ? new Response("", { status: 503 }) : safetyResponse(); }, retryDelayMs: 0, timeoutMs: 100 });
  assert.equal(retried.status, "DELIVERED");
  assert.equal(retried.attempts, 2);
  assert.equal(retried.executorStatus, "NOOP");
  await assert.rejects(() => dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "14", runAttempt: "1", fetchImpl: async () => new Response("", { status: 401 }), retryDelayMs: 0, timeoutMs: 100 }), /WEBHOOK_HTTP_401/);
});

test("a successful HTTP response with unsafe authority metadata is rejected", async () => {
  await assert.rejects(() => dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "push", repository: "cinamoncandy/NUSA", runId: "15", runAttempt: "1", fetchImpl: async () => new Response(JSON.stringify({ accepted: true, liveAuthority: "LIVE" }), { status: 202 }), retryDelayMs: 0, timeoutMs: 100 }), /WEBHOOK_RESPONSE_LIVE_AUTHORITY_INVALID/);
});

test("surfaces safe executor outcome and exact-head evidence", async () => {
  const headSha = "a".repeat(40);
  const result = await dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "19", runAttempt: "1", fetchImpl: async () => new Response(JSON.stringify(safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "DISPATCHED", reason: "github-repository-dispatch-accepted", httpStatus: 204, requestedHeadSha: headSha, observedHeadSha: headSha } })), { status: 202 }), retryDelayMs: 0, timeoutMs: 100 });
  assert.equal(result.executorStatus, "DISPATCHED");
  assert.equal(result.executorReason, "github-repository-dispatch-accepted");
  assert.equal(result.executorHttpStatus, 204);
  assert.equal(result.requestedHeadSha, headSha);
  assert.equal(result.observedHeadSha, headSha);
  assert.equal(result.auditFallbackEligible, false);
});

test("rejects malformed executor evidence at the bridge boundary", async () => {
  await assert.rejects(() => dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "17", runAttempt: "1", fetchImpl: async () => new Response(JSON.stringify(safetyPayload({ executor: { status: "FAILED", reason: "bad reason with spaces", httpStatus: 401 } })), { status: 202 }), retryDelayMs: 0, timeoutMs: 100 }), /WEBHOOK_EXECUTOR_REASON_INVALID/);
});

test("fails closed when an Audit request is accepted without a dispatch or approved credential fallback", async () => {
  await assert.rejects(() => dispatchGithubEvent({ secret: "bridge-test-secret", body, event: "workflow_run", repository: "cinamoncandy/NUSA", runId: "18", runAttempt: "1", fetchImpl: async () => new Response(JSON.stringify(safetyPayload({ execution: { kind: "AUDIT_REQUEST" }, executor: { status: "FAILED", reason: "github-executor-http-500", httpStatus: 500 } })), { status: 202 }), retryDelayMs: 0, timeoutMs: 100 }), /WEBHOOK_AUDIT_NOT_DISPATCHED:FAILED:github-executor-http-500:500/);
});

test("the primary bridge remains read-only and fallback write authority is isolated", () => {
  const normalized = workflow.replace(/\r\n/g, "\n");
  const bridgeStart = normalized.indexOf("  bridge:\n");
  const fallbackStart = normalized.indexOf("  audit-dispatch-fallback:\n");
  assert.ok(bridgeStart >= 0);
  assert.ok(fallbackStart > bridgeStart);
  const bridgeJob = normalized.slice(bridgeStart, fallbackStart);
  const fallbackJob = normalized.slice(fallbackStart);
  assert.match(normalized, /permissions: \{\}/);
  assert.equal((normalized.match(/contents: write/g) ?? []).length, 1);
  assert.doesNotMatch(normalized, /actions: write/);
  assert.doesNotMatch(normalized, /pull-requests: write/);
  assert.doesNotMatch(normalized, /NUSA_GITHUB_TOKEN/);
  assert.doesNotMatch(normalized, /NUSA_AUTOPILOT_HEALTH_URL/);
  assert.match(bridgeJob, /contents: read/);
  assert.match(bridgeJob, /id-token: write/);
  assert.doesNotMatch(bridgeJob, /contents: write/);
  assert.match(fallbackJob, /needs\.bridge\.outputs\.audit_fallback_eligible == 'true'/);
  assert.match(fallbackJob, /contents: write/);
  assert.match(fallbackJob, /actions: read/);
  assert.match(fallbackJob, /pull-requests: read/);
});

test("the bridge remains connected to the one existing event-planning spine", () => {
  const index = fs.readFileSync(path.resolve("apps", "autopilot", "src", "index.ts"), "utf8");
  const planner = fs.readFileSync(path.resolve("apps", "autopilot", "src", "dispatchPlanner.ts"), "utf8");
  assert.match(index, /url\.pathname.*"\/github\/webhook"/);
  assert.match(index, /planGithubWebhookDispatch/);
  assert.match(index, /planAutopilotExecution/);
  assert.match(index, /prepareProductionExecution/);
  assert.match(planner, /workflow-run-success-not-canonical-ci/);
  assert.match(planner, /workflow-run-originated-from-repository-dispatch/);
});
