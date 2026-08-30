import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeCodingRunner, validateCodingRunnerRequest, verifyCodingRunnerRequestAgainstGitHub, type CodingRuntime, type WorkersAiBinding } from "./codingRunner";

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

const patch = "diff --git a/apps/autopilot/src/example.ts b/apps/autopilot/src/example.ts\n--- a/apps/autopilot/src/example.ts\n+++ b/apps/autopilot/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n";

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

const runtimeEnv = {
  NUSA_AI_CODING_ENDPOINT: "https://coding.example.test/execute",
  NUSA_AI_CODING_TOKEN: "ai-token",
  NUSA_GITHUB_TOKEN: "github-token",
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
    assert.equal(calls, 2);
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

  it("falls back to public GitHub evidence when an optional token is rejected", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    await verifyCodingRunnerRequestAgainstGitHub(request, "stale-token", async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, authorization: headers?.Authorization });
      if (headers?.Authorization) return response(401, { message: "Bad credentials" });
      return verifiedGithubFetch(url);
    });
    assert.equal(calls.length, 4);
    assert.ok(calls.some((call) => call.authorization === "Bearer stale-token"));
    assert.ok(calls.some((call) => call.authorization === undefined));
  });

  it("accepts a failed workflow only for an explicit gha failure-repair request", async () => {
    const failureRequest = { ...request, reason: "gha:CI:123:failure" };
    await verifyCodingRunnerRequestAgainstGitHub(failureRequest, "github-token", async (url) => {
      if (url.includes("/commits/")) return response(200, { sha: request.headSha });
      return response(200, {
        id: request.workflowRunId,
        head_sha: request.headSha,
        head_branch: "main",
        status: "completed",
        conclusion: "failure",
        repository: { full_name: request.repository },
      });
    });
  });

  it("falls back to public GitHub evidence when a scoped token masks a public resource as not found", async () => {
    const calls: string[] = [];
    await verifyCodingRunnerRequestAgainstGitHub(request, "scoped-token", async (url, init) => {
      calls.push(`${url}:${(init?.headers as Record<string, string>)?.Authorization ?? "anonymous"}`);
      if (calls.length === 1) return response(404, { message: "Not Found" });
      return verifiedGithubFetch(url);
    });
    assert.equal(calls.length, 3);
    assert.match(calls[0] ?? "", /Bearer scoped-token/);
    assert.match(calls[1] ?? "", /anonymous/);
    assert.match(calls[2] ?? "", /Bearer scoped-token/);
  });

  it("sends a bounded patch-only proposal to the injected cloud runtime after GitHub verification", async () => {
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute(value, proposal) {
        runtimeCalls += 1;
        assert.equal(value.headSha, request.headSha);
        assert.equal(proposal?.patch, patch);
        return {
          backend: "fake-sandbox",
          checkpointId: request.headSha,
          workspaceVerified: true,
          proposalValidated: true,
          changedFiles: ["apps/autopilot/src/example.ts"],
        };
      },
    };
    const calls: string[] = [];
    const fakeFetch = async (url: string) => {
      calls.push(url);
      if (url.includes("/commits/") || url.includes("/actions/runs/")) return verifiedGithubFetch(url);
      return response(200, { patch });
    };
    const result = await executeCodingRunner(request, runtimeEnv, fakeFetch, runtime);
    assert.equal(result.status, "EXECUTION_ACCEPTED");
    assert.equal(result.backend, "fake-sandbox");
    assert.equal(result.workspaceVerified, true);
    assert.equal(result.proposalValidated, true);
    assert.deepEqual(result.changedFiles, ["apps/autopilot/src/example.ts"]);
    assert.equal(runtimeCalls, 1);
    assert.equal(calls.length, 3);
  });

  it("uses the Cloudflare Workers AI binding when no dedicated endpoint is configured", async () => {
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute(value, proposal) {
        runtimeCalls += 1;
        assert.equal(value.executionId, request.executionId);
        assert.equal(proposal?.patch, patch);
        return {
          backend: "fake-sandbox",
          checkpointId: request.headSha,
          workspaceVerified: true,
          proposalValidated: true,
          changedFiles: ["apps/autopilot/src/example.ts"],
        };
      },
    };
    const calls: Array<{ model: string; input: { prompt: string } }> = [];
    const ai: WorkersAiBinding = {
      async run(model, input) {
        calls.push({ model, input });
        return { response: JSON.stringify({ patch }) };
      },
    };
    const result = await executeCodingRunner(request, { NUSA_GITHUB_TOKEN: "github-token", AI: ai }, verifiedGithubFetch, runtime);
    assert.equal(result.status, "EXECUTION_ACCEPTED");
    assert.equal(result.proposalValidated, true);
    assert.equal(runtimeCalls, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.model, "@cf/meta/llama-3.1-8b-instruct");
    assert.match(calls[0]?.input.prompt ?? "", /unified diff/);
  });

  it("stays interface-ready when no provider-neutral coding engine is configured", async () => {
    const result = await executeCodingRunner(request, { NUSA_GITHUB_TOKEN: "github-token" }, verifiedGithubFetch);
    assert.equal(result.status, "INTERFACE_READY");
    assert.equal(result.reason, "ai-coding-engine-not-configured");
  });

  it("fails closed when the Workers AI binding is unavailable", async () => {
    const result = await executeCodingRunner(request, {
      NUSA_GITHUB_TOKEN: "github-token",
      AI: { async run() { throw new Error("provider unavailable"); } },
    }, verifiedGithubFetch);
    assert.equal(result.status, "EXECUTION_FAILED");
    assert.equal(result.reason, "provider unavailable");
  });

  it("fails closed when the coding engine does not return a patch proposal", async () => {
    let runtimeCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute() {
        runtimeCalls += 1;
        return { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true };
      },
    };
    const result = await executeCodingRunner(request, runtimeEnv, async (url) => {
      if (url.includes("/commits/") || url.includes("/actions/runs/")) return verifiedGithubFetch(url);
      return response(200, { accepted: true });
    }, runtime);
    assert.equal(result.status, "EXECUTION_FAILED");
    assert.equal(result.reason, "CODING_PROPOSAL_PATCH_REQUIRED");
    assert.equal(runtimeCalls, 0);
  });

  it("does not call the coding engine or runtime when GitHub evidence is invalid", async () => {
    let runtimeCalls = 0;
    let fetchCalls = 0;
    const runtime: CodingRuntime = {
      name: "fake-sandbox",
      async execute() {
        runtimeCalls += 1;
        return { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true };
      },
    };
    await assert.rejects(
      () => executeCodingRunner(request, runtimeEnv, async () => {
        fetchCalls += 1;
        return response(404, {});
      }, runtime),
      /CODING_RUNNER_HEAD_SHA_UNVERIFIED/,
    );
    assert.equal(runtimeCalls, 0);
    assert.equal(fetchCalls, 2);
  });

  it("preserves lifecycle identity and requires patch-only output when calling the configured coding engine", async () => {
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
      return response(202, { patch });
    };

    const result = await executeCodingRunner(request, runtimeEnv, fakeFetch);
    assert.equal(result.status, "EXECUTION_ACCEPTED");
    const dispatch = calls.at(-1);
    assert.equal(dispatch?.url, "https://coding.example.test/execute");
    const body = JSON.parse(String(dispatch?.init?.body));
    assert.equal(body.executionId, request.executionId);
    assert.equal(body.dedupeKey, request.dedupeKey);
    assert.deepEqual(body.outputContract, { patch: "unified-git-diff" });
    assert.equal(body.constraints.mutationAllowed, false);
    const headers = dispatch?.init?.headers as Record<string, string>;
    assert.equal(headers["x-nusa-execution-id"], request.executionId);
    assert.equal(headers["x-nusa-dedupe-key"], request.dedupeKey);
  });

  it("uses public GitHub verification when no GitHub token is configured", async () => {
    const seenAuthorization: Array<string | undefined> = [];
    const result = await executeCodingRunner(request, {}, async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seenAuthorization.push(headers?.Authorization);
      return verifiedGithubFetch(url);
    });
    assert.equal(result.status, "INTERFACE_READY");
    assert.equal(result.reason, "ai-coding-engine-not-configured");
    assert.deepEqual(seenAuthorization, [undefined, undefined]);
  });
});
