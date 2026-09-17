import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquirePersistentExecution, applyPersistentControlPlaneHold, clearPersistentControlPlaneHold, ExecutionCoordinator, readPersistentControlPlaneHold, releasePersistentExecution, type ExecutionCoordinatorNamespace } from "./executionCoordinator";
import { createCodingExecutionEvidence } from "./codingExecutionEvidence";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function codingEvidence(recordedAtMs: number) {
  const decision = createCodingExecutionEvidence({
    kind: "REPOSITORY_AUTOPILOT",
    repository: "cinamoncandy/NUSA",
    headSha: "a".repeat(40),
    workflowRunId: recordedAtMs + 1,
    reason: "gha:CI:success",
    executionId: `github:delivery-${recordedAtMs + 1}`,
    dedupeKey: `ci:${recordedAtMs + 1}:${"a".repeat(40)}`,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, {
    status: "EXECUTION_ACCEPTED",
    reason: "validated",
    backend: "cloudflare-sandbox",
    checkpointId: `checkpoint:${recordedAtMs + 1}`,
    workspaceVerified: true,
    proposalValidated: true,
    changedFiles: ["apps/autopilot/src/index.ts"],
  }, recordedAtMs);
  assert.equal(decision.status, "RECORDED");
  if (decision.status !== "RECORDED") throw new Error("fixture evidence was not recorded");
  return decision.evidence;
}

function fakeNamespace(status: number, body: object): ExecutionCoordinatorNamespace {
  const id = {};
  return {
    idFromName: () => id,
    get: () => ({
      fetch: async () => new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    }),
  };
}

describe("persistent execution coordination", () => {
  it("accepts a new lease", async () => {
    const result = await acquirePersistentExecution(fakeNamespace(201, { acquired: true }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:delivery-1",
      now: 100,
      leaseExpiresAt: 200,
    });
    assert.deepEqual(result, { acquired: true });
  });

  it("suppresses a duplicate", async () => {
    const result = await acquirePersistentExecution(fakeNamespace(409, { acquired: false, reason: "ALREADY_DISPATCHED" }), {
      dedupeKey: "ci:1:abc",
      executionId: "github:redelivery",
      now: 100,
      leaseExpiresAt: 200,
    });
    assert.deepEqual(result, { acquired: false, reason: "ALREADY_DISPATCHED" });
  });

  it("fails closed on coordinator failure", async () => {
    await assert.rejects(
      acquirePersistentExecution(fakeNamespace(500, { error: "FAILED" }), {
        dedupeKey: "ci:1:abc",
        executionId: "github:delivery-1",
        now: 100,
        leaseExpiresAt: 200,
      }),
      /PERSISTENT_EXECUTION_COORDINATION_FAILED/,
    );
  });

  it("releases a failed lease so a bounded retry can reacquire it", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    const namespace: ExecutionCoordinatorNamespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator.fetch(new Request(input, init)) }),
    };
    const request = { dedupeKey: "ci:retry:abc", executionId: "github:retry-1", now: 100, leaseExpiresAt: 1_000 };

    assert.deepEqual(await acquirePersistentExecution(namespace, request), { acquired: true });
    await releasePersistentExecution(namespace, { dedupeKey: request.dedupeKey, executionId: request.executionId, now: 200 });
    assert.deepEqual(await acquirePersistentExecution(namespace, { ...request, now: 201, leaseExpiresAt: 1_101 }), { acquired: true });
  });

  it("does not release an already dispatched execution", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    const namespace: ExecutionCoordinatorNamespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator.fetch(new Request(input, init)) }),
    };
    const request = { dedupeKey: "ci:dispatched:abc", executionId: "github:dispatched-1", now: 100, leaseExpiresAt: 1_000 };

    assert.deepEqual(await acquirePersistentExecution(namespace, request), { acquired: true });
    const marked = await coordinator.fetch(new Request("https://execution-coordinator/dispatched", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dedupeKey: request.dedupeKey, executionId: request.executionId, now: 150 }),
    }));
    assert.equal(marked.status, 200);
    await assert.rejects(
      releasePersistentExecution(namespace, { dedupeKey: request.dedupeKey, executionId: request.executionId, now: 200 }),
      /PERSISTENT_EXECUTION_RELEASE_FAILED/,
    );
  });

  it("persists, replays, orders, and deduplicates coding evidence without mutation", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    const first = codingEvidence(100);
    const second = codingEvidence(200);
    const post = (evidence: unknown) => coordinator.fetch(new Request("https://execution-coordinator/coding-evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidence }),
    }));

    assert.equal((await post(first)).status, 200);
    assert.equal((await post(first)).status, 200);
    assert.equal((await post(second)).status, 200);
    const response = await coordinator.fetch(new Request("https://execution-coordinator/coding-evidence-history"));
    assert.equal(response.status, 200);
    const body = await response.json() as { history: readonly { evidenceId: string; recordedAtMs: number }[]; liveAuthority: string; productionMutationAllowed: boolean; aiAuthority: string };
    assert.equal(body.history.length, 2);
    assert.deepEqual(body.history.map((entry) => entry.recordedAtMs), [100, 200]);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.aiAuthority, "ZERO_AUTHORITY");

    const restored = new ExecutionCoordinator({ storage });
    const replay = await restored.fetch(new Request("https://execution-coordinator/coding-evidence-history"));
    const replayBody = await replay.json() as { history: readonly { evidenceId: string }[] };
    assert.equal(replayBody.history.length, 2);
    assert.deepEqual(replayBody.history.map((entry) => entry.evidenceId), body.history.map((entry) => entry.evidenceId));
  });

  it("fails closed on malformed persisted coding evidence and enforces bounded retention", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    await storage.put("coding-execution-evidence-v1", { schemaVersion: 1, evidence: [{ secret: "must-not-replay" }] });
    const corrupted = await coordinator.fetch(new Request("https://execution-coordinator/coding-evidence-history"));
    assert.equal(corrupted.status, 500);
    assert.doesNotMatch(await corrupted.text(), /must-not-replay/);

    const cleanStorage = new MemoryStorage();
    const bounded = new ExecutionCoordinator({ storage: cleanStorage });
    for (let index = 0; index < 33; index += 1) {
      assert.equal((await bounded.fetch(new Request("https://execution-coordinator/coding-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: codingEvidence(index + 1_000) }),
      }))).status, 200);
    }
    const response = await bounded.fetch(new Request("https://execution-coordinator/coding-evidence-history"));
    const body = await response.json() as { history: readonly { recordedAtMs: number }[] };
    assert.equal(body.history.length, 32);
    assert.equal(body.history[0]?.recordedAtMs, 1_001);
    assert.equal(body.history.at(-1)?.recordedAtMs, 1_032);
  });
});


describe("persistent control-plane HOLD", () => {
  function namespace(): { namespace: ExecutionCoordinatorNamespace; storageByName: Map<string, MemoryStorage> } {
    const storageByName = new Map<string, MemoryStorage>();
    const coordinatorByName = new Map<string, ExecutionCoordinator>();
    const ns: ExecutionCoordinatorNamespace = {
      idFromName: (name) => ({ name }),
      get: (id) => {
        const name = String((id as { name?: unknown }).name ?? "");
        let coordinator = coordinatorByName.get(name);
        if (!coordinator) {
          const storage = new MemoryStorage();
          storageByName.set(name, storage);
          coordinator = new ExecutionCoordinator({ storage });
          coordinatorByName.set(name, coordinator);
        }
        return { fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator!.fetch(new Request(input, init)) };
      },
    };
    return { namespace: ns, storageByName };
  }

  const identity = Object.freeze({ repository: "cinamoncandy/NUSA", prNumber: 1854, headSha: "a".repeat(40), baseSha: "b".repeat(40) });
  const hold = Object.freeze({ holdId: "hold-1854-a", prNumber: identity.prNumber, headSha: identity.headSha, baseSha: identity.baseSha, reason: "GLOBAL_RELEASE_FREEZE" as const, source: "core:#1803/#1861" });

  it("persists and rehydrates an exact PR/head/base-bound HOLD", async () => {
    const { namespace: ns } = namespace();
    const applied = await applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 100 });
    assert.equal(applied.state, "ACTIVE");
    assert.deepEqual((await readPersistentControlPlaneHold(ns, identity))?.hold, hold);
    const replay = await applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 101 });
    assert.equal(replay.state, "ACTIVE");
  });

  it("rejects conflicting/replayed HOLD mutation after explicit clearance", async () => {
    const { namespace: ns } = namespace();
    await applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 100 });
    const cleared = await clearPersistentControlPlaneHold(ns, {
      ...identity,
      clearance: { holdId: hold.holdId, prNumber: identity.prNumber, headSha: identity.headSha, baseSha: identity.baseSha, clearedBy: "core", globalReleaseFreeze: false, blockedHuman: false, reworkRequired: false },
      now: 200,
    });
    assert.equal(cleared.state, "CLEARED");
    await assert.rejects(() => applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 201 }), /HOLD_APPLY_BLOCKED/);
  });

  it("fails closed on stale clearance and active global/human/rework blockers", async () => {
    const { namespace: ns } = namespace();
    await applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 100 });
    const base = { holdId: hold.holdId, prNumber: identity.prNumber, headSha: identity.headSha, baseSha: identity.baseSha, clearedBy: "core", globalReleaseFreeze: false, blockedHuman: false, reworkRequired: false };
    await assert.rejects(() => clearPersistentControlPlaneHold(ns, { ...identity, clearance: { ...base, holdId: "stale" }, now: 200 }), /HOLD_CLEAR_FAILED/);
    await assert.rejects(() => clearPersistentControlPlaneHold(ns, { ...identity, clearance: { ...base, globalReleaseFreeze: true }, now: 201 }), /HOLD_CLEAR_FAILED/);
    await assert.rejects(() => clearPersistentControlPlaneHold(ns, { ...identity, clearance: { ...base, blockedHuman: true }, now: 202 }), /HOLD_CLEAR_FAILED/);
    await assert.rejects(() => clearPersistentControlPlaneHold(ns, { ...identity, clearance: { ...base, reworkRequired: true }, now: 203 }), /HOLD_CLEAR_FAILED/);
  });

  it("isolates a new exact head from stale-head clear attempts", async () => {
    const { namespace: ns } = namespace();
    await applyPersistentControlPlaneHold(ns, { ...identity, hold, now: 100 });
    const next = { ...identity, headSha: "c".repeat(40) };
    assert.equal(await readPersistentControlPlaneHold(ns, next), null);
    await assert.rejects(() => clearPersistentControlPlaneHold(ns, {
      ...next,
      clearance: { holdId: hold.holdId, prNumber: next.prNumber, headSha: next.headSha, baseSha: next.baseSha, clearedBy: "core", globalReleaseFreeze: false, blockedHuman: false, reworkRequired: false },
      now: 200,
    }), /HOLD_CLEAR_FAILED/);
    assert.equal((await readPersistentControlPlaneHold(ns, identity))?.state, "ACTIVE");
  });
});
