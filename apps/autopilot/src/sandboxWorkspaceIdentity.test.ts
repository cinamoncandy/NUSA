import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSandboxWorkspaceIdentity } from "./sandboxWorkspaceIdentity";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

const envelope = (overrides: Partial<CodingExecutionEnvelope> = {}): CodingExecutionEnvelope => ({
  cycleId: "cycle-1",
  workItemId: "work-1",
  executionId: "execution:1",
  dedupeKey: "dedupe:1",
  origin: "AUTO_BACKGROUND",
  repository: "cinamoncandy/NUSA",
  baseSha: "a".repeat(40),
  workflowRunId: 1,
  objective: "bounded coding task",
  acceptanceCriteria: ["build"],
  evidenceRefs: ["run:1"],
  allowedScope: ["apps/autopilot/"],
  forbiddenScope: [],
  maxChangedFiles: 1,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  ...overrides,
});

describe("sandbox workspace identity", () => {
  it("is deterministic for the same execution envelope", async () => {
    const first = await deriveSandboxWorkspaceIdentity(envelope());
    const second = await deriveSandboxWorkspaceIdentity(envelope());
    assert.deepEqual(first, second);
    assert.match(first.sandboxId, /^task-[0-9a-f]{64}$/);
    assert.match(first.root, /^\/workspace\/nusa\/[0-9a-f]{64}$/);
  });

  it("does not alias punctuation-normalization variants", async () => {
    const colon = await deriveSandboxWorkspaceIdentity(envelope({ executionId: "a:b" }));
    const dash = await deriveSandboxWorkspaceIdentity(envelope({ executionId: "a-b" }));
    assert.notEqual(colon.sandboxId, dash.sandboxId);
    assert.notEqual(colon.root, dash.root);
  });

  it("does not alias execution IDs that only differ beyond the old truncation limit", async () => {
    const prefix = "x".repeat(96);
    const first = await deriveSandboxWorkspaceIdentity(envelope({ executionId: `${prefix}-one` }));
    const second = await deriveSandboxWorkspaceIdentity(envelope({ executionId: `${prefix}-two` }));
    assert.notEqual(first.sandboxId, second.sandboxId);
    assert.notEqual(first.root, second.root);
  });

  it("scopes identity to the exact checkout and lifecycle", async () => {
    const base = await deriveSandboxWorkspaceIdentity(envelope());
    const differentHead = await deriveSandboxWorkspaceIdentity(envelope({ baseSha: "b".repeat(40) }));
    const differentCycle = await deriveSandboxWorkspaceIdentity(envelope({ cycleId: "cycle-2" }));
    assert.notEqual(base.sandboxId, differentHead.sandboxId);
    assert.notEqual(base.sandboxId, differentCycle.sandboxId);
  });
});
