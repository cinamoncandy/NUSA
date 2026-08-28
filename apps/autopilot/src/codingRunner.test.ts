import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeCodingRunner, validateCodingRunnerRequest, verifyCodingRunnerRequestAgainstGitHub } from "./codingRunner";

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

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

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

  it("rejects a syntactically valid nonexistent SHA before coding execution", async () => {
    let calls = 0;
    await assert.rejects(
      () => verifyCodingRunnerRequestAgainstGitHub(request, "github-token", async () => {
        calls += 1;
        return response(404, { message: "Not Found" });
      }),
      /CODING_RUNNER_HEAD_SHA_UNVERIFIED/,
    );
    assert.equal(calls, 1);
  });

  it("rejects a stale or attacker-chosen SHA not bound to the trusted workflow run", async () => {
    const urls: string[] = [];
    await assert.rejects(
      () => verifyCodingRunnerRequestAgainstGitHub(request, "github-token", async (url) => {
        urls.push(url);
        if (url.includes("/commits/")) return response(200, { sha: request.headSha });
        return response(200, {
          id: request.workflowRunId,
          head_sha: "b".repeat(40),
          head_branch: "main",
          status: "completed",
          conclusion: "success",
          repository: { full_name: request.repository },
        });
      }),
      /CODING_RUNNER_WORKFLOW_HEAD_MISMATCH/,
    );
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.startsWith("https://api.github.com/repos/cinamoncandy/NUSA/")));
  });

  it("accepts only an existing SHA bound to the successful trusted workflow run", async () => {
    const urls: string[] = [];
    await verifyCodingRunnerRequestAgainstGitHub(request, "github-token", async (url) => {
      urls.push(url);
      if (url.includes("/commits/")) return response(200, { sha: request.headSha });
      return response(200, {
        id: request.workflowRunId,
        head_sha: request.headSha,
        head_branch: "feat/auto-coding-runner",
        status: "completed",
        conclusion: "success",
        repository: { full_name: request.repository },
      });
    });
    assert.equal(urls.length, 2);
  });

  it("stays interface-ready until a real AI coding engine is configured", async () => {
    assert.deepEqual(await executeCodingRunner(request, {}), { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" });
  });
});
