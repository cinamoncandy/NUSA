import assert from "node:assert/strict";
import test from "node:test";
import { executeCodingRunner, type CodingPublisher, type CodingRuntime } from "./codingRunner";

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

const fetchImpl = async (url: string) => {
  if (url.includes("/commits/")) return response(200, { sha: request.headSha });
  if (url.includes("/actions/runs/")) return response(200, {
    id: request.workflowRunId,
    head_sha: request.headSha,
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    repository: { full_name: request.repository },
  });
  return response(200, { patch });
};

const env = {
  NUSA_AI_CODING_ENDPOINT: "https://coding.example.test/execute",
  NUSA_AI_CODING_TOKEN: "ai-token",
  NUSA_GITHUB_TOKEN: "github-token",
};

test("publishes only after the runtime returns sandbox-validated exact file bytes", async () => {
  const runtime: CodingRuntime = {
    name: "fake-sandbox",
    async execute() {
      return {
        backend: "fake-sandbox",
        checkpointId: request.headSha,
        workspaceVerified: true,
        proposalValidated: true,
        changedFiles: ["apps/autopilot/src/example.ts"],
        validatedFiles: [{ path: "apps/autopilot/src/example.ts", content: "new\n" }],
      };
    },
  };
  let publisherCalls = 0;
  const publisher: CodingPublisher = {
    name: "fake-publisher",
    async publish(value, validated) {
      publisherCalls += 1;
      assert.equal(value.headSha, request.headSha);
      assert.equal(validated.proposalValidated, true);
      assert.deepEqual(validated.validatedFiles, [{ path: "apps/autopilot/src/example.ts", content: "new\n" }]);
      return {
        publisher: "fake-publisher",
        branch: "nusa/autopilot/test",
        commitSha: "b".repeat(40),
        pullRequestNumber: 88,
        pullRequestUrl: "https://github.com/cinamoncandy/NUSA/pull/88",
      };
    },
  };

  const result = await executeCodingRunner(request, env, fetchImpl, runtime, publisher);
  assert.equal(result.status, "EXECUTION_ACCEPTED");
  assert.equal(result.proposalValidated, true);
  assert.equal(result.publisher, "fake-publisher");
  assert.equal(result.pullRequestNumber, 88);
  assert.equal(publisherCalls, 1);
});

test("does not invoke a publisher when the runtime did not return validated file bytes", async () => {
  const runtime: CodingRuntime = {
    name: "fake-sandbox",
    async execute() {
      return { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true };
    },
  };
  let publisherCalls = 0;
  const publisher: CodingPublisher = {
    name: "fake-publisher",
    async publish() {
      publisherCalls += 1;
      throw new Error("should-not-run");
    },
  };

  const result = await executeCodingRunner(request, env, fetchImpl, runtime, publisher);
  assert.equal(result.status, "EXECUTION_FAILED");
  assert.equal(result.reason, "CODING_PUBLISH_VALIDATION_REQUIRED");
  assert.equal(publisherCalls, 0);
});
