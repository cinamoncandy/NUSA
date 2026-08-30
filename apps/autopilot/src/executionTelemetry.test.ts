import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquirePersistentExecution, ExecutionCoordinator, markPersistentExecutionDispatched, type ExecutionCoordinatorNamespace } from "./executionCoordinator";
import { classifyAutopilotFailure, createAutopilotExecutionTelemetry, validateAutopilotExecutionTelemetry } from "./executionTelemetry";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function coordinatorNamespace(coordinator: ExecutionCoordinator): ExecutionCoordinatorNamespace {
  const id = {};
  return {
    idFromName: () => id,
    get: () => ({ fetch: (input, init) => coordinator.fetch(new Request(input, init)) }),
  };
}

function telemetry(timestampMs: number, result = "EXECUTION_ACCEPTED") {
  return createAutopilotExecutionTelemetry({
    executionId: `github:execution-${timestampMs}`,
    timestampMs,
    trigger: "repository_dispatch",
    decision: "coding-dispatch",
    action: "ACTION",
    selectedExecutor: "cloud-coding-runner",
    dedupeKey: `ci:1:${timestampMs}`,
    attempt: 1,
    retry: { attempt: 1, maxAttempts: 1, backoffMs: 0 },
    recovery: { action: "NONE", reason: null },
    checkpoint: { checkpointId: null, resumed: false },
    durationMs: 25,
    result,
    validationResult: "NOT_RUN",
    ciResult: "VERIFIED",
    failureClass: result.includes("DUPLICATE") ? "deterministic" : null,
    commitSha: null,
    pullRequestNumber: null,
    failureReason: result.includes("DUPLICATE") ? "LEASE_ACTIVE" : null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

describe("autopilot execution telemetry", () => {
  it("creates and validates a complete fail-closed execution record", () => {
    const record = telemetry(3_600_000);
    validateAutopilotExecutionTelemetry(record);
    assert.equal(record.action, "ACTION");
    assert.equal(record.selectedExecutor, "cloud-coding-runner");
    assert.equal(record.retry.maxAttempts, 1);
    assert.equal(record.recovery.action, "NONE");
    assert.equal(record.checkpoint.resumed, false);
    assert.equal(record.liveAuthority, "NONE");
    assert.equal(record.productionMutationAllowed, false);
    assert.equal(record.aiAuthority, "ZERO_AUTHORITY");
  });

  it("classifies retryable and non-retryable failure classes explicitly", () => {
    assert.equal(classifyAutopilotFailure("network timeout"), "transient");
    assert.equal(classifyAutopilotFailure("storage coordinator failure"), "infrastructure");
    assert.equal(classifyAutopilotFailure("executor unavailable"), "executor_unavailable");
    assert.equal(classifyAutopilotFailure("proposal validation failed"), "validation_failure");
    assert.equal(classifyAutopilotFailure("permission denied"), "permission_auth");
    assert.equal(classifyAutopilotFailure("unsafe ambiguous execution"), "unsafe_ambiguous");
    assert.equal(classifyAutopilotFailure("deterministic contract mismatch"), "deterministic");
    assert.equal(classifyAutopilotFailure(null), null);
  });

  it("persists idempotently and builds hourly aggregates", async () => {
    const coordinator = new ExecutionCoordinator({ storage: new MemoryStorage() });
    const first = telemetry(3_600_000);
    const duplicate = telemetry(3_600_001, "DUPLICATE_EXECUTION_SUPPRESSED");
    const post = (value: unknown) => coordinator.fetch(new Request("https://execution-coordinator/execution-telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ telemetry: value }),
    }));

    assert.equal((await post(first)).status, 200);
    assert.equal((await post(first)).status, 200);
    assert.equal((await post(duplicate)).status, 200);

    const response = await coordinator.fetch(new Request("https://execution-coordinator/execution-telemetry"));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      telemetry: { result: string };
      history: readonly unknown[];
      summary: { telemetryCount: number; actionCount: number; duplicateSuppressedCount: number; hourly: readonly { executions: number; duplicates: number }[] };
    };
    assert.equal(body.telemetry.result, "DUPLICATE_EXECUTION_SUPPRESSED");
    assert.equal(body.history.length, 2);
    assert.equal(body.summary.telemetryCount, 2);
    assert.equal(body.summary.actionCount, 2);
    assert.equal(body.summary.duplicateSuppressedCount, 1);
    assert.deepEqual(body.summary.hourly, [{ hourStartMs: 3_600_000, executions: 2, actions: 2, noActions: 0, successes: 1, failures: 0, duplicates: 1 }]);
  });

  it("allows one effective dispatch for a dedupe key", async () => {
    const coordinator = new ExecutionCoordinator({ storage: new MemoryStorage() });
    const namespace = coordinatorNamespace(coordinator);
    const first = { dedupeKey: "ci:1258:abc", executionId: "github:first", now: 100, leaseExpiresAt: 200 };
    assert.deepEqual(await acquirePersistentExecution(namespace, first), { acquired: true });
    assert.deepEqual(await acquirePersistentExecution(namespace, { ...first, executionId: "github:duplicate" }), { acquired: false, reason: "LEASE_ACTIVE" });
    await markPersistentExecutionDispatched(namespace, { dedupeKey: first.dedupeKey, executionId: first.executionId, now: 150 });
    assert.deepEqual(await acquirePersistentExecution(namespace, { ...first, executionId: "github:redelivery", now: 151 }), { acquired: false, reason: "ALREADY_DISPATCHED" });
  });
});
