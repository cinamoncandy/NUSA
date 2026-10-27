import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SCHEDULED_CODING_ATTEMPTS, runScheduledEvolutionCoding } from "./scheduledEvolutionCoding";
import { ExecutionCoordinator, handoffOrAcquirePersistentExecution, readPersistentExecution, releasePersistentExecution, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

const MAIN_SHA = "a".repeat(40);
const RUN_ID = 9001;
const NOW = 1_787_968_000_000;
const FIVE_MINUTES = 5 * 60 * 1000;
const CODING_EXECUTION_WINDOW = 20 * 60 * 1000;

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

/** Execution records go to a real coordinator per dedupe identity; auxiliary state stays empty. */
function namespace(): ExecutionCoordinatorNamespace {
  const coordinators = new Map<string, ExecutionCoordinator>();
  return {
    idFromName: (name: string) => ({ name }),
    get: (id: unknown) => {
      const name = (id as { name: string }).name;
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const url = String(input);
          if (url.endsWith("/evolve-learning-memory")) return new Response(JSON.stringify({ value: null }), { status: 200, headers: { "content-type": "application/json" } });
          if (url.endsWith("/provider-capacity-wait")) return new Response(JSON.stringify({ wait: null }), { status: 200, headers: { "content-type": "application/json" } });
          let coordinator = coordinators.get(name);
          if (!coordinator) {
            coordinator = new ExecutionCoordinator({ storage: new MemoryStorage() });
            coordinators.set(name, coordinator);
          }
          return coordinator.fetch(new Request(url, init));
        },
      };
    },
  };
}

// The 2026-10-12 shape: one CI failure on main that no attempt can fix.
const candidates = [{
  id: RUN_ID,
  name: "CI",
  conclusion: "failure",
  head_branch: "main",
  head_sha: MAIN_SHA,
  event: "push",
  completed_at: new Date(NOW - 60_000).toISOString(),
}];

test("the scheduler stops re-dispatching the same unfixable failure after the attempt ceiling", async () => {
  const ns = namespace();
  let dispatches = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: MAIN_SHA } }), { status: 200 });
    if (String(input).endsWith("/dispatches")) {
      dispatches += 1;
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcomes = [];
  for (let tick = 0; tick < MAX_SCHEDULED_CODING_ATTEMPTS + 2; tick += 1) {
    const now = NOW + tick * FIVE_MINUTES;
    const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: ns }, {
      candidates,
      now,
      repository: "cinamoncandy/NUSA",
      mainSha: MAIN_SHA,
      workflowRunId: RUN_ID,
    }, fetchImpl);
    outcomes.push(outcome);
    if (outcome.status === "EXECUTION_ACCEPTED") {
      // The consumer fails closed and releases the lease, exactly as the failed repairs did.
      const workIdentity = (outcome.selectedSignalIds[0] ?? "").replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 180);
      const dedupeKey = `evolve-coding:${MAIN_SHA}:${workIdentity}`;
      const record = await readPersistentExecution(ns, dedupeKey);
      assert.ok(record, "dispatched work keeps a durable record");
      assert.equal(record.state, "LEASED", "the producer keeps the lease available for the asynchronous consumer handoff");
      assert.deepEqual(await handoffOrAcquirePersistentExecution(ns, {
        dedupeKey: record.dedupeKey,
        executionId: record.executionId,
        now: now + 500,
        leaseExpiresAt: now + CODING_EXECUTION_WINDOW,
      }), { acquired: true });
      const handedOff = await readPersistentExecution(ns, dedupeKey);
      assert.equal(handedOff?.state, "HANDED_OFF");
      assert.equal(handedOff?.leaseExpiresAt, now + CODING_EXECUTION_WINDOW, "consumer lease expiry supersedes the shorter producer lease");
      await releasePersistentExecution(ns, { dedupeKey: record.dedupeKey, executionId: record.executionId, now: now + 1_000 });
    }
  }

  assert.equal(dispatches, MAX_SCHEDULED_CODING_ATTEMPTS);
  assert.deepEqual(outcomes.slice(0, MAX_SCHEDULED_CODING_ATTEMPTS).map((outcome) => outcome.status), Array(MAX_SCHEDULED_CODING_ATTEMPTS).fill("EXECUTION_ACCEPTED"));
  for (const outcome of outcomes.slice(MAX_SCHEDULED_CODING_ATTEMPTS)) {
    assert.equal(outcome.status, "DUPLICATE_SUPPRESSED");
    assert.equal(outcome.reason, "ATTEMPT_LIMIT_REACHED");
  }
});

test("a new main SHA is a new identity and may be attempted again", async () => {
  const ns = namespace();
  let dispatches = 0;
  const nextSha = "c".repeat(40);
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: nextSha } }), { status: 200 });
    if (String(input).endsWith("/dispatches")) {
      dispatches += 1;
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: ns }, {
    candidates: [{ ...candidates[0], head_sha: nextSha }],
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: nextSha,
    workflowRunId: RUN_ID + 1,
  }, fetchImpl);
  assert.equal(outcome.status, "EXECUTION_ACCEPTED");
  assert.equal(dispatches, 1);
});
