import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createDeliveryId, createGithubSignature, dispatchGithubEvent } from "../scripts/dispatch-github-event-to-autopilot.mjs";

const workflow = fs.readFileSync(path.resolve(".github", "workflows", "autopilot-github-event-bridge.yml"), "utf8");
const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: "cinamoncandy/NUSA" } }));
const safetyResponse = () => new Response(JSON.stringify({
  accepted: true,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
}), { status: 202, headers: { "content-type": "application/json" } });

test("the event bridge uses one deterministic delivery identity and exact HMAC bytes", () => {
  const first = createDeliveryId({ repository: "cinamoncandy/NUSA", event: "push", runId: "10", runAttempt: "2" });
  const second = createDeliveryId({ repository: "cinamoncandy/NUSA", event: "push", runId: "10", runAttempt: "2" });
  assert.equal(first, second);
  assert.equal(createGithubSignature("bridge-test-secret", body), `sha256=${crypto.createHmac("sha256", "bridge-test-secret").update(body).digest("hex")}`);
});

test("missing OIDC and repository secret fails closed without making a request", async () => {
  let calls = 0;
  await assert.rejects(() => dispatchGithubEvent({
    secret: "",
    body,
    event: "push",
    repository: "cinamoncandy/NUSA",
    runId: "11",
    runAttempt: "1",
    fetchImpl: async () => { calls += 1; return safetyResponse(); },
  }), /WEBHOOK_AUTH_REQUIRED/);
  assert.equal(calls, 0);
});

test("pull_request_target is delivered as the canonical pull_request event", async () => {
  let request;
  const result = await dispatchGithubEvent({
    secret: "bridge-test-secret",
    body,
    event: "pull_request_target",
    repository: "cinamoncandy/NUSA",
    runId: "12",
    runAttempt: "1",
    webhookUrl: "https://autopilot.example.test/github/webhook",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return safetyResponse();
    },
    timeoutMs: 100,
  });
  assert.equal(result.status, "DELIVERED");
  assert.equal(request.url, "https://autopilot.example.test/github/webhook");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["x-github-event"], "pull_request");
  assert.equal(request.init.headers["x-github-delivery"], result.deliveryId);
  assert.equal(Buffer.from(request.init.body).toString(), body.toString());
  assert.equal(request.init.headers["x-hub-signature-256"], createGithubSignature("bridge-test-secret", body));
});

test("transient delivery failures retry once while authentication failures fail closed", async () => {
  let calls = 0;
  const retried = await dispatchGithubEvent({
    secret: "bridge-test-secret",
    body,
    event: "workflow_run",
    repository: "cinamoncandy/NUSA",
    runId: "13",
    runAttempt: "1",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 503 }) : safetyResponse();
    },
    retryDelayMs: 0,
    timeoutMs: 100,
  });
  assert.equal(retried.status, "DELIVERED");
  assert.equal(retried.attempts, 2);

  await assert.rejects(() => dispatchGithubEvent({
    secret: "bridge-test-secret",
    body,
    event: "workflow_run",
    repository: "cinamoncandy/NUSA",
    runId: "14",
    runAttempt: "1",
    fetchImpl: async () => new Response("", { status: 401 }),
    retryDelayMs: 0,
    timeoutMs: 100,
  }), /WEBHOOK_HTTP_401/);
});

test("a successful HTTP response with unsafe authority metadata is rejected", async () => {
  await assert.rejects(() => dispatchGithubEvent({
    secret: "bridge-test-secret",
    body,
    event: "push",
    repository: "cinamoncandy/NUSA",
    runId: "15",
    runAttempt: "1",
    fetchImpl: async () => new Response(JSON.stringify({ accepted: true, liveAuthority: "LIVE" }), { status: 202 }),
    retryDelayMs: 0,
    timeoutMs: 100,
  }), /WEBHOOK_RESPONSE_LIVE_AUTHORITY_INVALID/);
});

test("the workflow is a read-only bridge to the existing canonical webhook", () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]/);
  assert.match(workflow, /node scripts\/dispatch-github-event-to-autopilot\.mjs/);
  assert.match(workflow, /NUSA_WEBHOOK_SECRET:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.doesNotMatch(workflow, /NUSA_GITHUB_TOKEN/);
  assert.doesNotMatch(workflow, /LIVE|ACTIVE/);
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
