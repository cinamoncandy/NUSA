import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleCodingProposal, ExecutionCoordinator, type WorkerEnv } from "./worker";
import { readProviderCapacityWait, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

const HEAD = "a".repeat(40);
const request = {
  kind: "REPOSITORY_AUTOPILOT" as const,
  repository: "cinamoncandy/NUSA",
  headSha: HEAD,
  workflowRunId: 123,
  reason: "evolve:discovery:github-issue-2118",
  executionId: "evolve-coding:aaaaaaaaaaaaaaaa:github-issue-2118",
  dedupeKey: `evolve-coding:${HEAD}:github-issue-2118`,
  mutationAllowed: false as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

const QUOTA_ERROR = "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

function memoryNamespace(): ExecutionCoordinatorNamespace {
  const storage = new MemoryStorage();
  const coordinator = new ExecutionCoordinator({ storage });
  return {
    idFromName: () => ({}),
    get: () => ({ fetch: (input: RequestInfo, init?: RequestInit) => coordinator.fetch(new Request(input, init)) }),
  };
}

function proposalRequest(): Request {
  return new Request("https://worker.example.test/coding/propose", {
    method: "POST",
    headers: { authorization: "Bearer coding-token", "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

async function withStubbedGithubFetch<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const value = String(url);
    if (value.includes("/commits/")) return new Response(JSON.stringify({ sha: HEAD }), { status: 200 });
    if (value.includes("/actions/runs/")) {
      return new Response(JSON.stringify({
        id: request.workflowRunId,
        head_sha: HEAD,
        head_branch: "main",
        repository: { full_name: request.repository },
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${value}`);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function baseEnv(coordinator: ExecutionCoordinatorNamespace): WorkerEnv {
  return {
    NUSA_GITHUB_REPOSITORY: request.repository,
    NUSA_CODING_RUNNER_TOKEN: "coding-token",
    NUSA_GITHUB_TOKEN: "github-token",
    NUSA_EXECUTION_COORDINATOR: coordinator,
  } as unknown as WorkerEnv;
}

describe("/coding/propose provider-capacity gating", () => {
  it("makes no provider call and reports the wait when the shared provider wait is active", async () => {
    await withStubbedGithubFetch(async () => {
      const coordinator = memoryNamespace();
      const future = Date.now() + 60 * 60 * 1000;
      const stop = {
        schemaVersion: 1 as const,
        taskId: "t",
        executionId: "prior",
        provider: "workers-ai",
        headSha: HEAD,
        stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
        stoppedAt: Date.now(),
        attemptCount: 1,
        lastFailure: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
        nextRetryAt: future,
        resumeCondition: "provider-capacity-and-exact-head-revalidation",
        dedupeKey: "prior-dedupe",
        evidenceRef: null,
      };
      const { recordProviderCapacityWait } = await import("./executionCoordinator");
      await recordProviderCapacityWait(coordinator, stop);

      let aiCalls = 0;
      const env = { ...baseEnv(coordinator), AI: { async run() { aiCalls += 1; return { response: "{}" }; } } } as unknown as WorkerEnv;
      const response = await handleCodingProposal(proposalRequest(), env);
      const body = await response.json() as { accepted: boolean; status: string; nextRetryAt: number | null };
      assert.equal(response.status, 409);
      assert.equal(body.accepted, false);
      assert.equal(body.status, "CODING_PROPOSAL_FAILED_CLOSED");
      assert.equal(body.nextRetryAt, future);
      assert.equal(aiCalls, 0, "must not spend a real Workers AI call while a provider wait is active");
    });
  });

  it("records a daily-quota stop in the shared provider wait so a later distinct task also stops", async () => {
    await withStubbedGithubFetch(async () => {
      const coordinator = memoryNamespace();
      let aiCalls = 0;
      const env = { ...baseEnv(coordinator), AI: { async run() { aiCalls += 1; throw new Error(QUOTA_ERROR); } } } as unknown as WorkerEnv;

      const first = await handleCodingProposal(proposalRequest(), env);
      assert.equal(first.status, 409);
      assert.equal(aiCalls, 1);

      const wait = await readProviderCapacityWait(coordinator, "workers-ai");
      assert.ok(wait, "the daily-quota stop must be recorded in the shared provider wait");
      assert.equal(wait?.stopReason, "WORKERS_AI_DAILY_QUOTA_EXHAUSTED");
      assert.ok(wait!.nextRetryAt > Date.now() + 60_000, "a daily-quota wait must extend well past the 60s local retry ceiling");

      // A distinct task hitting the same endpoint must now be stopped by the shared wait,
      // without spending a second real Workers AI call.
      const secondRequest = { ...request, executionId: "evolve-coding:aaaaaaaaaaaaaaaa:different-task", dedupeKey: `evolve-coding:${HEAD}:different-task` };
      const second = await handleCodingProposal(new Request("https://worker.example.test/coding/propose", {
        method: "POST",
        headers: { authorization: "Bearer coding-token", "content-type": "application/json" },
        body: JSON.stringify(secondRequest),
      }), env);
      assert.equal(second.status, 409);
      assert.equal(aiCalls, 1, "a second distinct task must not spend another real Workers AI call once the shared wait is recorded");
    });
  });

  it("fails closed without a provider call when the shared provider-wait state is unreadable", async () => {
    await withStubbedGithubFetch(async () => {
      const brokenCoordinator: ExecutionCoordinatorNamespace = {
        idFromName: () => ({}),
        get: () => ({ fetch: async () => new Response("", { status: 500 }) }),
      };
      let aiCalls = 0;
      const env = { ...baseEnv(brokenCoordinator), AI: { async run() { aiCalls += 1; return { response: "{}" }; } } } as unknown as WorkerEnv;
      const response = await handleCodingProposal(proposalRequest(), env);
      assert.equal(response.status, 409);
      assert.equal(aiCalls, 0);
    });
  });
});
