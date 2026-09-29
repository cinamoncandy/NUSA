import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchGithubEvent } from "./dispatch-github-event-to-autopilot.mjs";

describe("dispatchGithubEvent duplicate Audit evidence", () => {
  it("treats durable duplicate suppression as a delivered fail-closed decline", async () => {
    const headSha = "a".repeat(40);
    const result = await dispatchGithubEvent({
      secret: "secret",
      body: new TextEncoder().encode("{}"),
      event: "pull_request",
      repository: "cinamoncandy/NUSA",
      runId: "35320405773",
      runAttempt: "1",
      webhookUrl: "https://worker.example.test/github/webhook",
      fetchImpl: async () => new Response(JSON.stringify({
        accepted: true,
        status: "DUPLICATE_EXECUTION_SUPPRESSED",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
        execution: {
          kind: "AUDIT_REQUEST",
          repository: "cinamoncandy/NUSA",
          headSha,
          prNumber: 1898,
          workflowRunId: 35319943559,
          reason: "audit:pr:1898",
          mutationAllowed: false,
        },
        executor: {
          status: "REJECTED",
          reason: "github-executor-duplicate-execution-suppressed",
          httpStatus: null,
          requestedHeadSha: headSha,
          observedHeadSha: null,
        },
      }), { status: 202, headers: { "content-type": "application/json" } }),
      retryDelayMs: 0,
    });

    assert.equal(result.status, "DELIVERED");
    assert.equal(result.executorStatus, "REJECTED");
    assert.equal(result.executorReason, "github-executor-duplicate-execution-suppressed");
    assert.equal(result.auditFallbackEligible, false);
  });
});
