import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeCodingRunner, validateCodingRunnerRequest, verifyCodingRunnerRequestAgainstGitHub, type CodingRuntime } from "./codingRunner";

const request = {
  kind: "REPOSITORY_AUTOPILOT" as const,
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123,
  reason: "continue-from:ci_succeeded",
  executionId: "github:delivery-123",
  dedupeKey: `ci:123:${"a".repeat(40)}`,
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

const verifiedGithubFetch = async (url: string) => {
  if (url.includes("/commits/")) return response(200, { sha: request.headSha });
  return response(200, {
    id: request.workflowRunId,
    head_sha: request.headSha,
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    repository: { full_name: request.repository },
  });
};

describe("coding runner", () => {
  it("accepts only the fail-closed repository contract with lifecycle identity", () => {
    assert.deepEqual(validateCodingRunnerRequest(request), request);
  });

  it("rejects missing or malformed lifecycle identity", () => {
    assert.throws(() => validateCodingRunnerRequest({ ...request, executionId: "" }), /CODING_RUNNER_EXECUTION_ID_INVALID/);
    assert.throws(() => validateCodingRunnerRequest({ ...request, dedupeKey: "bad key" }), /CODING_RUNNER_DEDUPE_KEY_INVALID/);
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
      return verifiedGithubFetch(url);
    });
    assert.equal(urls.length, 2);
  });

  it("executes an injected cloud runtime only after GitHub evidence verification", async () => {
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute(value) {
        runtimeCalls += 1;
        assert.equal(value.headSha, request.headSha);
        return { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true };
      },
    };
    const result = await executeCodingRunner(request, { NUSA_GITHUB_TOKEN: "github-token" }, verifiedGithubFetch, runtime);
    assert.equal(result.status, "EXECUTION_ACCEPTED");
    assert.equal(result.backend, "fake-sandbox");
    assert.equal(result.workspaceVerified, true);
    assert.equal(runtimeCalls, 1);
  });

  it("does not invoke an injected runtime when GitHub evidence is invalid", async () => {
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute() {
        runtimeCalls += 1;
        return { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true };
      },
    };
    await assert.rejects(
      () => executeCodingRunner(request, { NUSA_GITHUB_TOKEN: "github-token" }, async () => response(404, {}), runtime),
      /CODING_RUNNER_HEAD_SHA_UNVERIFIED/,
    );
    assert.equal(runtimeCalls, 0);
  });

  it("preserves lifecycle identity when calling the configured coding engine", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/commits/")) return response(200, { sha: request.headSha });
      if (url.includes("/actions/runs/")) return response(200, {
        id: request.workflowRunId,
        head_sha: request.headSha,
        head_branch: "main",
        status: "completed",
        conclusion: "success",
        repository: { full_name: request.repository },
      });
      return response(202, { accepted: true });
    };

    const result = await executeCodingRunner(request, {
      NUSA_AI_CODING_ENDPOINT: "https://coding.example.test/execute",
      NUSA_AI_CODING_TOKEN: "ai-token",
      NUSA_GITHUB_TOKEN: "github-token",
    }, fakeFetch);
    assert.equal(result.status, "EXECUTION_ACCEPTED");
    const dispatch = calls.at(-1);
    assert.equal(dispatch?.url, "https://coding.example.test/execute");
    const body = JSON.parse(String(dispatch?.init?.body));
    assert.equal(body.executionId, request.executionId);
    assert.equal(body.dedupeKey, request.dedupeKey);
    const headers = dispatch?.init?.headers as Record<string, string>;
    assert.equal(headers["x-nusa-execution-id"], request.executionId);
    assert.equal(headers["x-nusa-dedupe-key"], request.dedupeKey);
  });

  it("stays interface-ready until a real AI coding engine is configured", async () => {
    assert.deepEqual(await executeCodingRunner(request, {}), { status: "INTERFACE_READY", reason: "ai-coding-engine-not-configured" });
  });
});
