import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeGithubDispatch } from "./githubExecutor";
import type { AutopilotExecutionRequest } from "./executionPlanner";

const request: AutopilotExecutionRequest = {
  kind: "REPOSITORY_AUTOPILOT",
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123456789,
  reason: "continue-from:ci_succeeded",
  executionId: "github:delivery-123",
  dedupeKey: `ci:123456789:${"a".repeat(40)}`,
  mutationAllowed: false,
};

describe("executeGithubDispatch", () => {
  it("stays interface-ready when no executor token is configured", async () => {
    const value = await executeGithubDispatch(request, { allowedRepository: "cinamoncandy/NUSA" });
    assert.equal(value.status, "INTERFACE_READY");
    assert.equal(value.reason, "github-executor-token-not-configured");
  });

  it("fails closed on repository mismatch and invalid SHA", async () => {
    assert.equal((await executeGithubDispatch({ ...request, repository: "other/repo" }, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    })).status, "REJECTED");
    assert.equal((await executeGithubDispatch({ ...request, headSha: "bad" }, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    })).status, "REJECTED");
  });

  it("rejects dispatch without trusted workflow or lifecycle identity before network access", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    assert.equal((await executeGithubDispatch({ ...request, workflowRunId: null }, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    }, fakeFetch)).reason, "github-executor-workflow-run-id-required");
    assert.equal((await executeGithubDispatch({ ...request, executionId: null }, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    }, fakeFetch)).reason, "github-executor-execution-id-required");
    assert.equal((await executeGithubDispatch({ ...request, dedupeKey: null }, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    }, fakeFetch)).reason, "github-executor-dedupe-key-required");
    assert.equal(called, false);
  });

  it("sends one bounded repository dispatch with durable lifecycle identity and no authority escalation", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const value = await executeGithubDispatch(request, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
      apiBaseUrl: "https://api.example.test/",
    }, fakeFetch);

    assert.equal(value.status, "DISPATCHED");
    assert.equal(capturedUrl, "https://api.example.test/repos/cinamoncandy/NUSA/dispatches");
    assert.equal(capturedInit?.method, "POST");
    const payload = JSON.parse(String(capturedInit?.body));
    assert.equal(payload.event_type, "nusa_autopilot_execution");
    assert.equal(payload.client_payload.kind, "REPOSITORY_AUTOPILOT");
    assert.equal(payload.client_payload.workflow_run_id, 123456789);
    assert.equal(payload.client_payload.execution_id, request.executionId);
    assert.equal(payload.client_payload.dedupe_key, request.dedupeKey);
    assert.equal(payload.client_payload.production_mutation_allowed, false);
    assert.equal(payload.client_payload.live_authority, "NONE");
    assert.equal(payload.client_payload.ai_authority, "ZERO_AUTHORITY");
  });

  it("classifies auth and scope failures without leaking response bodies", async () => {
    const fakeFetch = (async () => new Response("secret-detail", { status: 403 })) as typeof fetch;
    const value = await executeGithubDispatch(request, {
      token: "secret",
      allowedRepository: "cinamoncandy/NUSA",
    }, fakeFetch);
    assert.equal(value.status, "FAILED");
    assert.equal(value.reason, "github-executor-auth-rejected");
    assert.equal(value.httpStatus, 403);
  });
});
