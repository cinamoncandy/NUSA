import { describe, expect, it } from "vitest";
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
    expect(validateCodingRunnerRequest(request)).toEqual(request);
  });

  it("rejects production mutation authority", () => {
    expect(() => validateCodingRunnerRequest({ ...request, productionMutationAllowed: true })).toThrow("CODING_RUNNER_PRODUCTION_MUTATION_FORBIDDEN");
  });

  it("rejects generic or mismatched repositories", () => {
    expect(() => validateCodingRunnerRequest({ ...request, repository: "other/repo" })).toThrow("CODING_RUNNER_REPOSITORY_INVALID");
  });

  it("stays interface-ready until a real AI coding engine is configured", async () => {
    await expect(executeCodingRunner(request, {})).resolves.toEqual({ status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" });
  });
});
