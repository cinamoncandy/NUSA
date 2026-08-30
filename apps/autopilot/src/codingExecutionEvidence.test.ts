import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCodingExecutionEvidence, validatePersistedCodingExecutionEvidence } from "./codingExecutionEvidence";

const request = {
  kind: "REPOSITORY_AUTOPILOT" as const,
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123,
  reason: "gha:CI:a".repeat(1),
  executionId: "github:delivery-123",
  dedupeKey: `ci:123:${"a".repeat(40)}`,
  mutationAllowed: false as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

describe("coding execution evidence", () => {
  it("is deterministic and retains only safe execution outcome metadata", () => {
    const result = {
      status: "EXECUTION_ACCEPTED",
      reason: "bounded-repair-created",
      backend: "cloudflare-sandbox",
      checkpointId: "checkpoint:123",
      workspaceVerified: true as const,
      proposalValidated: true as const,
      changedFiles: ["apps/autopilot/src/z.ts", "apps/autopilot/src/a.ts", "apps/autopilot/src/a.ts", "../../secret.txt"],
      publisher: "github-validated-patch-publisher",
      branch: "nusa/autopilot/123",
      commitSha: "b".repeat(40),
      pullRequestNumber: 456,
      pullRequestUrl: "https://github.com/cinamoncandy/NUSA/pull/456",
    };
    const first = createCodingExecutionEvidence(request, result, 1_000);
    const second = createCodingExecutionEvidence(request, result, 1_000);
    assert.equal(first.status, "RECORDED");
    assert.deepEqual(second, first);
    if (first.status === "RECORDED") {
      assert.equal(first.evidence.liveAuthority, "NONE");
      assert.equal(first.evidence.productionMutationAllowed, false);
      assert.equal(first.evidence.aiAuthority, "ZERO_AUTHORITY");
      assert.deepEqual(first.evidence.outcome.changedFiles, ["apps/autopilot/src/a.ts", "apps/autopilot/src/z.ts"]);
      validatePersistedCodingExecutionEvidence(first.evidence);
    }
  });

  it("redacts unsafe free-form values and never persists them", () => {
    const decision = createCodingExecutionEvidence(request, {
      status: "EXECUTION_FAILED",
      reason: "token=super-secret",
      backend: "sandbox\nsecret",
      checkpointId: "checkpoint:1",
      changedFiles: ["apps/autopilot/src/ok.ts", "apps/autopilot/src/../../secret.ts"],
      pullRequestUrl: "https://attacker.example.test/pr/1",
    }, 2_000);
    assert.equal(decision.status, "RECORDED");
    if (decision.status === "RECORDED") {
      assert.equal(decision.evidence.outcome.reason, null);
      assert.equal(decision.evidence.outcome.backend, null);
      assert.equal(decision.evidence.outcome.pullRequestUrl, null);
      assert.deepEqual(decision.evidence.outcome.changedFiles, ["apps/autopilot/src/ok.ts"]);
      assert.doesNotMatch(JSON.stringify(decision.evidence), /super-secret|attacker\.example/);
    }
  });

  it("rejects authority drift and invalid lifecycle identity", () => {
    assert.deepEqual(createCodingExecutionEvidence({ ...request, productionMutationAllowed: true } as unknown as typeof request, { status: "NO_ACTION" }, 1), { status: "REJECTED", reason: "AUTHORITY_INVALID" });
    assert.deepEqual(createCodingExecutionEvidence({ ...request, executionId: "bad id" }, { status: "NO_ACTION" }, 1), { status: "REJECTED", reason: "LIFECYCLE_IDENTITY_INVALID" });
    assert.deepEqual(createCodingExecutionEvidence(request, { status: "NO ACTION" }, 1), { status: "REJECTED", reason: "RESULT_STATUS_INVALID" });
  });
});
