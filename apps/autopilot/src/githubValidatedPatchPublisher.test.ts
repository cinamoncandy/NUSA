import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodingRunnerRequest, CodingRuntimeExecutionResult } from "./codingRunner";
import { GithubValidatedPatchPublisher } from "./githubValidatedPatchPublisher";

const request: CodingRunnerRequest = Object.freeze({
  kind: "REPOSITORY_AUTOPILOT",
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123,
  reason: "continue-from:ci_succeeded",
  executionId: "github:delivery-123",
  dedupeKey: `ci:123:${"a".repeat(40)}`,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const runtime: CodingRuntimeExecutionResult = Object.freeze({
  backend: "fake-sandbox",
  checkpointId: request.headSha,
  workspaceVerified: true,
  proposalValidated: true,
  changedFiles: ["apps/autopilot/src/example.ts"],
  validatedFiles: [{ path: "apps/autopilot/src/example.ts", content: "export const value = 2;\n" }],
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("github validated patch publisher", () => {
  it("rejects publication unless sandbox validation produced exact file bytes", async () => {
    const publisher = new GithubValidatedPatchPublisher({ token: "token", allowedRepository: request.repository }, async () => response(500, {}));
    await assert.rejects(
      () => publisher.publish(request, { backend: "fake", checkpointId: request.headSha, workspaceVerified: true }),
      /CODING_PUBLISH_VALIDATION_REQUIRED/,
    );
  });

  it("suppresses publication if main moved after validation", async () => {
    const publisher = new GithubValidatedPatchPublisher({ token: "token", allowedRepository: request.repository }, async (url) => {
      assert.match(url, /git\/ref\/heads\/main$/);
      return response(200, { object: { sha: "b".repeat(40) } });
    });
    await assert.rejects(() => publisher.publish(request, runtime), /CODING_PUBLISH_STALE_HEAD_SUPPRESSED/);
  });

  it("publishes only the validated bytes through blob tree commit branch and pull request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const treeSha = "b".repeat(40);
    const blobSha = "c".repeat(40);
    const newTreeSha = "d".repeat(40);
    const commitSha = "e".repeat(40);
    const publisher = new GithubValidatedPatchPublisher({ token: "token", allowedRepository: request.repository }, async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/git/ref/heads/main")) return response(200, { object: { sha: request.headSha } });
      if (url.endsWith(`/git/commits/${request.headSha}`)) return response(200, { tree: { sha: treeSha } });
      if (url.endsWith("/git/blobs")) return response(201, { sha: blobSha });
      if (url.endsWith("/git/trees")) return response(201, { sha: newTreeSha });
      if (url.endsWith("/git/commits")) return response(201, { sha: commitSha });
      if (url.endsWith("/git/refs")) return response(201, { ref: "refs/heads/nusa/autopilot/test" });
      if (url.endsWith("/pulls")) return response(201, { number: 77, html_url: "https://github.com/cinamoncandy/NUSA/pull/77" });
      return response(404, {});
    });

    const result = await publisher.publish(request, runtime);
    assert.equal(result.commitSha, commitSha);
    assert.equal(result.pullRequestNumber, 77);
    assert.match(result.branch, /^nusa\/autopilot\//);
    assert.equal(calls.length, 7);

    const blobCall = calls.find((call) => call.url.endsWith("/git/blobs"));
    assert.deepEqual(JSON.parse(String(blobCall?.init?.body)), { content: "export const value = 2;\n", encoding: "utf-8" });
    const treeCall = calls.find((call) => call.url.endsWith("/git/trees"));
    const treeBody = JSON.parse(String(treeCall?.init?.body));
    assert.equal(treeBody.base_tree, treeSha);
    assert.deepEqual(treeBody.tree, [{ path: "apps/autopilot/src/example.ts", mode: "100644", type: "blob", sha: blobSha }]);
    const commitCall = calls.find((call) => call.url.endsWith("/git/commits"));
    assert.deepEqual(JSON.parse(String(commitCall?.init?.body)).parents, [request.headSha]);
    const pullCall = calls.find((call) => call.url.endsWith("/pulls"));
    const pullBody = JSON.parse(String(pullCall?.init?.body));
    assert.equal(pullBody.base, "main");
    assert.equal(pullBody.head, result.branch);
  });
});
