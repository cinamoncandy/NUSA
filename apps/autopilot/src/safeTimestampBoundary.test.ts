import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { prepareProductionExecution } from "./productionExecutionSpine";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const repository = "cinamoncandy/NUSA";
const success: AutopilotDispatchPlan = Object.freeze({
  kind: "CI_SUCCEEDED",
  repository,
  headSha: "a".repeat(40),
  prNumber: null,
  workflowRunId: 12345,
  reason: "workflow-run-success",
  mutationAllowed: false,
});

const coordinator = {} as ExecutionCoordinatorNamespace;

describe("scheduled and production timestamp boundaries", () => {
  it("fails closed before network access for unsafe scheduled timestamps", async () => {
    for (const now of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      const outcome = await runScheduledAutopilot({
        NUSA_GITHUB_TOKEN: "token",
        NUSA_EXECUTION_COORDINATOR: coordinator,
      }, now, (() => { throw new Error("network must not be reached"); }) as typeof fetch);
      assert.equal(outcome.status, "ABSTAINED");
      assert.equal(outcome.reason, "scheduled-time-invalid");
      assert.equal(outcome.liveAuthority, "NONE");
      assert.equal(outcome.productionMutationAllowed, false);
      assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
    }
  });

  it("rejects unsafe production time and lease TTL values", () => {
    const base = {
      deliveryId: "delivery-safe-time",
      origin: "AUTO_BACKGROUND" as const,
      now: 1_000,
      allowedRepository: repository,
    };
    for (const now of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      assert.throws(() => prepareProductionExecution(success, { ...base, now }), /TIME_INVALID/);
    }
    for (const leaseTtlMs of [1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      assert.throws(() => prepareProductionExecution(success, { ...base, leaseTtlMs }), /LEASE_TTL_INVALID/);
    }
    assert.throws(
      () => prepareProductionExecution(success, { ...base, now: Number.MAX_SAFE_INTEGER - 10, leaseTtlMs: 11 }),
      /LEASE_INVALID/,
    );
  });
});
