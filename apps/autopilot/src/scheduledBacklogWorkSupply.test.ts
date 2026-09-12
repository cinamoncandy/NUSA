import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;
const NOW = 1_789_189_200_000;
const SAFETY = "Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.";

function namespace(acquired = true): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/acquire")) return new Response(JSON.stringify(acquired ? { acquired: true } : { acquired: false, reason: "ALREADY_DISPATCHED" }), { status: acquired ? 201 : 409, headers: { "content-type": "application/json" } });
        if (url.endsWith("/dispatched")) return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("not found", { status: 404 });
      },
    }),
  };
}

function safeIssue(number: number): Record<string, unknown> {
  return {
    number,
    title: `P1: AUTOPILOT bounded work ${number}`,
    body: `apps/autopilot/src improvement. ${SAFETY}`,
    state: "open",
    author_association: "OWNER",
    labels: [],
    updated_at: new Date(NOW - number * 1000).toISOString(),
  };
}

test("healthy exact-main discovers backlog readiness and dispatches one candidate through existing coding spine", async () => {
  let codingReason = "";
  const issues = [safeIssue(1901), safeIssue(1902)];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/search/issues") && url.includes("is%3Aissue")) return new Response(JSON.stringify({ total_count: 2, items: issues }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/search/issues") && url.includes("is%3Apr")) return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/actions/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/dispatches")) {
      const body = JSON.parse(String(init?.body));
      codingReason = body.client_payload.reason;
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, NOW, fetchImpl);
  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.workSupply.rawOpenIssueCount, 2);
  assert.equal(outcome.workSupply.readyWorkStatus, "OBSERVED");
  assert.equal(outcome.workSupply.readyWorkCount, 2);
  assert.match(codingReason, /GitHub issue #1901/);
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("linked open PR removes the canonical issue from READY supply", async () => {
  const issue = safeIssue(1901);
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/search/issues") && url.includes("is%3Aissue")) return new Response(JSON.stringify({ total_count: 1, items: [issue] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/search/issues") && url.includes("is%3Apr")) return new Response(JSON.stringify({ total_count: 1, items: [{ title: "fix autopilot", body: "Fixes #1901" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/actions/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, NOW, fetchImpl);
  assert.equal(outcome.workSupply.readyWorkStatus, "OBSERVED");
  assert.equal(outcome.workSupply.readyWorkCount, 0);
});

test("incomplete pagination never fabricates a READY count", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/search/issues") && url.includes("is%3Aissue")) return new Response(JSON.stringify({ total_count: 101, items: [safeIssue(1901)] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/actions/runs?")) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, NOW, fetchImpl);
  assert.equal(outcome.workSupply.rawOpenIssueCount, 101);
  assert.equal(outcome.workSupply.readyWorkStatus, "UNKNOWN");
  assert.equal(outcome.workSupply.readyWorkCount, null);
});
