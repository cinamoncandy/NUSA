import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker, {
  classifyGithubEvent,
  computeGithubWebhookSignature,
  handleCodingExecute,
  verifyGithubWebhookSignature,
} from "./index";
import { createCodingExecutionEvidence } from "./codingExecutionEvidence";
import type { CodingRuntime } from "./codingRunner";
import { ExecutionCoordinator, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function evidenceFixture() {
  const result = createCodingExecutionEvidence({
    kind: "REPOSITORY_AUTOPILOT",
    repository: "cinamoncandy/NUSA",
    headSha: "a".repeat(40),
    workflowRunId: 44,
    reason: "gha:CI:success",
    executionId: "github:delivery-44",
    dedupeKey: `ci:44:${"a".repeat(40)}`,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, { status: "EXECUTION_ACCEPTED", reason: "validated", backend: "cloudflare-sandbox", checkpointId: "checkpoint:44", workspaceVerified: true }, 44);
  assert.equal(result.status, "RECORDED");
  if (result.status !== "RECORDED") throw new Error("fixture evidence was not recorded");
  return result.evidence;
}

const codingRequest = {
  kind: "REPOSITORY_AUTOPILOT" as const,
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 1258,
  reason: "continue-from:ci_succeeded",
  executionId: "github:delivery-1258",
  dedupeKey: `ci:1258:${"a".repeat(40)}`,
  mutationAllowed: false as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

describe("NUSA autopilot GitHub webhook", () => {
  it("classifies only the bounded event surface", () => {
    assert.equal(classifyGithubEvent("ping"), "ping");
    assert.equal(classifyGithubEvent("push"), "push");
    assert.equal(classifyGithubEvent("pull_request"), "pull_request");
    assert.equal(classifyGithubEvent("workflow_run"), "workflow_run");
    assert.equal(classifyGithubEvent("issues"), null);
    assert.equal(classifyGithubEvent(null), null);
  });

  it("exposes a fail-closed deployment revision health signal", async () => {
    const unverified = await worker.fetch(new Request("https://example.test/health"), {});
    assert.equal(unverified.status, 200);
    const unverifiedPayload = await unverified.json() as { deploymentRevision: string; executionTelemetry: string };
    assert.equal(unverifiedPayload.deploymentRevision, "UNVERIFIED");
    assert.equal(unverifiedPayload.executionTelemetry, "INTERFACE_READY");

    const verified = await worker.fetch(new Request("https://example.test/health"), { NUSA_DEPLOYMENT_REVISION: "a".repeat(40) });
    assert.equal((await verified.json() as { deploymentRevision: string }).deploymentRevision, "a".repeat(40));
  });

  it("verifies the exact request body with HMAC SHA-256", async () => {
    const signature = await computeGithubWebhookSignature("secret", "{\"ok\":true}");
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":true}", signature), true);
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":false}", signature), false);
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":true}", null), false);
  });

  it("fails closed when the secret is absent", async () => {
    const response = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-delivery": "delivery-1", "x-github-event": "push" },
      body: "{}",
    }), {});
    assert.equal(response.status, 503);
  });

  it("rejects missing delivery identity and unsupported events", async () => {
    const noDelivery = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "push" },
      body: "{}",
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(noDelivery.status, 400);

    const unsupported = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-delivery": "delivery-2", "x-github-event": "issues" },
      body: "{}",
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(unsupported.status, 422);
  });

  it("rejects invalid signatures and plans a valid bounded execution request without mutation authority", async () => {
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: "a".repeat(40),
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    const invalid = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-3",
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(invalid.status, 401);

    const signature = await computeGithubWebhookSignature("secret", body);
    const valid = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-4",
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(valid.status, 202);
    const payload = await valid.json() as {
      accepted: boolean;
      status: string;
      dispatch: { kind: string; headSha: string; mutationAllowed: boolean };
      execution: {
        kind: string;
        repository: string | null;
        headSha: string | null;
        workflowRunId: number | null;
        reason: string;
        mutationAllowed: boolean;
      };
    };
    assert.equal(payload.accepted, true);
    assert.equal(payload.status, "EXECUTION_REQUEST_PLANNED");
    assert.equal(payload.dispatch.kind, "MAIN_PUSH");
    assert.equal(payload.dispatch.headSha, "a".repeat(40));
    assert.equal(payload.dispatch.mutationAllowed, false);
    assert.deepEqual(payload.execution, {
      kind: "REPOSITORY_AUTOPILOT",
      repository: "cinamoncandy/NUSA",
      headSha: "a".repeat(40),
      workflowRunId: null,
      reason: "continue-from:main_push",
      mutationAllowed: false,
    });
  });

  it("rejects malformed signed JSON instead of planning from partial data", async () => {
    const body = "{";
    const signature = await computeGithubWebhookSignature("secret", body);
    const response = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-json",
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(response.status, 400);
  });

  it("projects persisted coding evidence through a read-only safety boundary", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    const evidence = evidenceFixture();
    await coordinator.fetch(new Request("https://execution-coordinator/coding-evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidence }),
    }));
    const namespace: ExecutionCoordinatorNamespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator.fetch(new Request(input, init)) }),
    };
    const response = await worker.fetch(new Request("https://example.test/coding/evidence"), { NUSA_EXECUTION_COORDINATOR: namespace });
    assert.equal(response.status, 200);
    const payload = await response.json() as { status: string; history: readonly unknown[]; liveAuthority: string; productionMutationAllowed: boolean; aiAuthority: string };
    assert.equal(payload.status, "OBSERVED");
    assert.equal(payload.history.length, 1);
    assert.equal(payload.liveAuthority, "NONE");
    assert.equal(payload.productionMutationAllowed, false);
    assert.equal(payload.aiAuthority, "ZERO_AUTHORITY");
  });

  it("suppresses duplicate cloud coding calls at the execution boundary", async () => {
    const storage = new MemoryStorage();
    const coordinator = new ExecutionCoordinator({ storage });
    const namespace: ExecutionCoordinatorNamespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator.fetch(new Request(input, init)) }),
    };
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-cloud-runtime",
      async execute() {
        runtimeCalls += 1;
        return {
          backend: "fake-cloud-runtime",
          checkpointId: "checkpoint:1258",
          workspaceVerified: true,
          proposalValidated: true,
          changedFiles: ["apps/autopilot/src/index.ts"],
        };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/commits/")) return new Response(JSON.stringify({ sha: codingRequest.headSha }), { status: 200 });
      if (url.includes("/actions/runs/")) return new Response(JSON.stringify({
        id: codingRequest.workflowRunId,
        head_sha: codingRequest.headSha,
        head_branch: "main",
        status: "completed",
        conclusion: "success",
        repository: { full_name: codingRequest.repository },
      }), { status: 200 });
      return new Response(JSON.stringify({ patch: "diff --git a/apps/autopilot/src/index.ts b/apps/autopilot/src/index.ts\n" }), { status: 200 });
    }) as typeof fetch;
    try {
      const request = () => new Request("https://example.test/coding/execute", {
        method: "POST",
        headers: { authorization: "Bearer runner-token", "content-type": "application/json" },
        body: JSON.stringify(codingRequest),
      });
      const env = {
        NUSA_CODING_RUNNER_TOKEN: "runner-token",
        NUSA_GITHUB_TOKEN: "github-token",
        NUSA_AI_CODING_ENDPOINT: "https://coding.example.test/execute",
        NUSA_AI_CODING_TOKEN: "ai-token",
        NUSA_EXECUTION_COORDINATOR: namespace,
      };
      const first = await handleCodingExecute(request(), env, runtime);
      const second = await handleCodingExecute(request(), env, runtime);
      assert.equal(first.status, 202);
      assert.equal((await first.clone().json() as { status: string }).status, "EXECUTION_ACCEPTED");
      assert.equal(second.status, 202);
      assert.equal((await second.json() as { status: string }).status, "DUPLICATE_EXECUTION_SUPPRESSED");
      assert.equal(runtimeCalls, 1);
      const telemetry = await coordinator.fetch(new Request("https://execution-coordinator/execution-telemetry"));
      const telemetryBody = await telemetry.json() as { history: readonly unknown[]; summary: { duplicateSuppressedCount: number } };
      assert.equal(telemetryBody.history.length, 2);
      assert.equal(telemetryBody.summary.duplicateSuppressedCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
