import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeCodingRunner, validateCodingRunnerRequest } from "./codingRunner";

const request = {
  kind: "REPOSITORY_AUTOPILOT" as const,
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123,
  reason: "continue-from:ci_succeeded",
  mutationAllowed: false as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

describe("coding runner", () => {
  it("accepts only the fail-closed repository contract", () => {
    assert.deepEqual(validateCodingRunnerRequest(request), request);
  });

  it("rejects production mutation authority", () => {
    assert.throws(() => validateCodingRunnerRequest({ ...request, productionMutationAllowed: true }), /CODING_RUNNER_PRODUCTION_MUTATION_FORBIDDEN/);
  });

  it("rejects generic or mismatched repositories", () => {
    assert.throws(() => validateCodingRunnerRequest({ ...request, repository: "other/repo" }), /CODING_RUNNER_REPOSITORY_INVALID/);
  });

  it("stays interface-ready until a real AI coding engine is configured", async () => {
    assert.deepEqual(await executeCodingRunner(request, {}), { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" });
  });
});
