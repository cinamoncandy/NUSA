import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;
const NOW = Date.parse("2026-09-17T08:00:00.000Z");
const SAFETY = "Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.";

function namespace(withPreviousReceipt = false): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/scheduled-receipt")) {
          const receipt = withPreviousReceipt ? {
            scheduledTime: NOW - 60_000,
            observedAt: NOW - 30_000,
            status: "EXECUTION_DISPATCHED",
            reason: "prior-pass",
            headSha: SHA,
            workflowRunId: RUN_ID,
            liveAuthority: "NONE",
            productionMutationAllowed: false,
            aiAuthority: "ZERO_AUTHORITY",
          } : null;
          return new Response(JSON.stringify({ receipt }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/acquire")) return new Response(JSON.stringify({ acquired: true }), { status: 201, headers: { "content-type": "application/json" } });
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
    updated_at: new Date(NOW - number).toISOString(),
  };
}

function fetchFor(issues: readonly unknown[], pulls: readonly unknown[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/search/issues") && url.includes("is%3Aissue")) return new Response(JSON.stringify({ total_count: issues.length, items: issues }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/search/issues") && url.includes("is%3Apr")) return new Response(JSON.stringify({ total_count: pulls.length, items: pulls }), { status: 200, headers: { "content-type": "application/json" } });
    const issueMatch = url.match(/\/issues\/([1-9][0-9]*)$/);
    if (issueMatch) {
      const selected = issues.find((value) => Number((value as Record<string, unknown>)?.number) === Number(issueMatch[1]));
      return selected
        ? new Response(JSON.stringify(selected), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("not found", { status: 404 });
    }
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/actions/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("healthy exact-main backlog is evaluated before unchanged-state suppression", async () => {
  const outcome = await runScheduledAutopilot(
    { NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace(true) },
    NOW,
    fetchFor([safeIssue(1901)]),
  );
  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.workSupply.rawOpenIssueCount, 1);
  assert.equal(outcome.workSupply.readyWorkCount, 1);
});

test("linked open PR removes issue from READY supply", async () => {
  const outcome = await runScheduledAutopilot(
    { NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() },
    NOW,
    fetchFor([safeIssue(1901)], [{ title: "fix autopilot", body: "Fixes #1901" }]),
  );
  assert.equal(outcome.workSupply.readyWorkStatus, "OBSERVED");
  assert.equal(outcome.workSupply.readyWorkCount, 0);
});

test("incomplete issue evidence never fabricates READY zero", async () => {
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
