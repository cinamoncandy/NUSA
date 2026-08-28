import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { prepareProductionExecution } from "./productionExecutionSpine";

const repository = "cinamoncandy/NUSA";
const headSha = "a".repeat(40);
const dispatch: AutopilotDispatchPlan = Object.freeze({
  kind: "CI_SUCCEEDED",
  repository,
  headSha,
  prNumber: null,
  workflowRunId: 12345,
  reason: "workflow-run-success",
  mutationAllowed: false,
});

describe("production execution lifecycle identity", () => {
  it("carries the same durable identity from bounded envelope to GitHub executor request", () => {
    const prepared = prepareProductionExecution(dispatch, {
      deliveryId: "delivery-123",
      origin: "AUTO_BACKGROUND",
      now: 1_000,
      allowedRepository: repository,
    });
    assert.ok(prepared);
    assert.equal(prepared.request.executionId, prepared.envelope.executionId);
    assert.equal(prepared.request.dedupeKey, prepared.envelope.dedupeKey);
    assert.equal(prepared.request.executionId, "github:delivery-123");
    assert.equal(prepared.request.dedupeKey, `ci:12345:${headSha}`);
  });
});
