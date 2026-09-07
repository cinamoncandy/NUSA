import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { prepareProductionExecution } from "./productionExecutionSpine";

const repository = "cinamoncandy/NUSA";
const sha = "a".repeat(40);
const success: AutopilotDispatchPlan = Object.freeze({
  kind: "CI_SUCCEEDED",
  repository,
  headSha: sha,
  prNumber: null,
  workflowRunId: 12345,
  reason: "workflow-run-success",
  mutationAllowed: false,
});

const options = Object.freeze({
  deliveryId: "delivery-123",
  origin: "AUTO_BACKGROUND" as const,
  now: 1_000,
  allowedRepository: repository,
});

describe("production execution spine", () => {
  it("binds verified CI evidence to identity, lease, bounded envelope, and runner request", () => {
    const prepared = prepareProductionExecution(success, options);
    assert.ok(prepared);
    assert.equal(prepared.state.status, "CODING_DISPATCHED");
    assert.equal(prepared.state.lease?.holder, "cloudflare:nusa-autopilot");
    assert.equal(prepared.envelope.baseSha, sha);
    assert.equal(prepared.envelope.workflowRunId, 12345);
    assert.equal(prepared.envelope.origin, "AUTO_BACKGROUND");
    assert.equal(prepared.envelope.mutationAllowed, false);
    assert.equal(prepared.request.headSha, sha);
    assert.equal(prepared.request.workflowRunId, 12345);
    assert.match(prepared.request.reason, /execution:github:delivery-123/);
  });

  it("derives a stable dedupe key from exact CI evidence across webhook redelivery", () => {
    const first = prepareProductionExecution(success, options);
    const retry = prepareProductionExecution(success, { ...options, deliveryId: "delivery-retry", now: 2_000 });
    assert.ok(first && retry);
    assert.equal(first.envelope.dedupeKey, retry.envelope.dedupeKey);
    assert.notEqual(first.envelope.executionId, retry.envelope.executionId);
  });

  it("does not dispatch from push, PR, failure, or ignored planning signals", () => {
    for (const kind of ["MAIN_PUSH", "PR_CHANGED", "CI_FAILED", "IGNORED"] as const) {
      assert.equal(prepareProductionExecution({ ...success, kind }, options), null);
    }
  });

  it("fails closed on missing exact workflow evidence or repository mismatch", () => {
    assert.throws(() => prepareProductionExecution({ ...success, workflowRunId: null }, options), /WORKFLOW_RUN_REQUIRED/);
    assert.throws(() => prepareProductionExecution(success, { ...options, allowedRepository: "other/repo" }), /REPOSITORY_INVALID/);
  });

  it("never grants mutation or authority through the production composition", () => {
    const prepared = prepareProductionExecution(success, options);
    assert.ok(prepared);
    assert.equal(prepared.state.mutationAllowed, false);
    assert.equal(prepared.envelope.liveAuthority, "NONE");
    assert.equal(prepared.envelope.productionMutationAllowed, false);
    assert.equal(prepared.envelope.aiAuthority, "ZERO_AUTHORITY");
  });
});
