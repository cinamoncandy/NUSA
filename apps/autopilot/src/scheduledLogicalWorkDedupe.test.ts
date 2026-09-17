import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledEvolutionCoding } from "./scheduledEvolutionCoding";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;
const NOW = Date.parse("2026-09-17T08:00:00.000Z");
const SAFETY = "Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.";

function issue(number: number): Record<string, unknown> {
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

function namespace(seen: Set<string>, acquiredKeys: string[]): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const url = String(input);
        if (url.endsWith("/acquire")) {
          const body = JSON.parse(String(init?.body)) as { dedupeKey: string };
          acquiredKeys.push(body.dedupeKey);
          if (seen.has(body.dedupeKey)) return new Response(JSON.stringify({ acquired: false, reason: "ALREADY_DISPATCHED" }), { status: 409, headers: { "content-type": "application/json" } });
          seen.add(body.dedupeKey);
          return new Response(JSON.stringify({ acquired: true }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/dispatched")) return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("not found", { status: 404 });
      },
    }),
  };
}

test("same main dispatches B after A gains an open PR because dedupe is logical-work-bound", async () => {
  const seen = new Set<string>();
  const acquiredKeys: string[] = [];
  const coordinator = namespace(seen, acquiredKeys);
  const dispatchedReasons: string[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { client_payload?: { reason?: string } };
    dispatchedReasons.push(body.client_payload?.reason ?? "");
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const first = await runScheduledEvolutionCoding(
    { NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: coordinator },
    { candidates: [], backlogIssues: [issue(1901), issue(1902)], openPulls: [], now: NOW, repository: "cinamoncandy/NUSA", mainSha: SHA, workflowRunId: RUN_ID },
    fetchImpl,
  );
  assert.equal(first.status, "EXECUTION_ACCEPTED");
  assert.deepEqual(first.selectedSignalIds, ["github-issue-1901"]);

  const second = await runScheduledEvolutionCoding(
    { NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: coordinator },
    { candidates: [], backlogIssues: [issue(1901), issue(1902)], openPulls: [{ title: "fix A", body: "Fixes #1901" }], now: NOW + 1000, repository: "cinamoncandy/NUSA", mainSha: SHA, workflowRunId: RUN_ID },
    fetchImpl,
  );
  assert.equal(second.status, "EXECUTION_ACCEPTED");
  assert.deepEqual(second.selectedSignalIds, ["github-issue-1902"]);
  assert.equal(acquiredKeys.length, 2);
  assert.notEqual(acquiredKeys[0], acquiredKeys[1]);
  assert.match(acquiredKeys[0]!, /github-issue-1901/);
  assert.match(acquiredKeys[1]!, /github-issue-1902/);
  assert.match(dispatchedReasons[0]!, /GitHub issue #1901/);
  assert.match(dispatchedReasons[1]!, /GitHub issue #1902/);
});

test("same logical work on same main remains persistently deduplicated", async () => {
  const seen = new Set<string>();
  const acquiredKeys: string[] = [];
  const coordinator = namespace(seen, acquiredKeys);
  const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const input = { candidates: [], backlogIssues: [issue(1901)], openPulls: [], now: NOW, repository: "cinamoncandy/NUSA", mainSha: SHA, workflowRunId: RUN_ID } as const;

  assert.equal((await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: coordinator }, input, fetchImpl)).status, "EXECUTION_ACCEPTED");
  assert.equal((await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: coordinator }, { ...input, now: NOW + 1000 }, fetchImpl)).status, "DUPLICATE_SUPPRESSED");
  assert.equal(acquiredKeys[0], acquiredKeys[1]);
});
