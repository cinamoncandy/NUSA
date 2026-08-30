import test from "node:test";
import assert from "node:assert/strict";
import { assertBoundedSandboxPatch, extractPatchPaths } from "./sandboxPatchValidator";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

const envelope: CodingExecutionEnvelope = {
  cycleId: "cycle-1",
  workItemId: "work-1",
  executionId: "exec-1",
  dedupeKey: "dedupe-1",
  origin: "AUTO_BACKGROUND",
  repository: "cinamoncandy/NUSA",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  workflowRunId: 1,
  objective: "repair bounded autopilot failure",
  acceptanceCriteria: ["build passes"],
  evidenceRefs: ["gha:1"],
  allowedScope: ["apps/autopilot/src"],
  forbiddenScope: ["apps/autopilot/src/index.ts"],
  maxChangedFiles: 3,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

test("extractPatchPaths deduplicates modified paths", () => {
  const patch = [
    "diff --git a/apps/autopilot/src/foo.ts b/apps/autopilot/src/foo.ts",
    "--- a/apps/autopilot/src/foo.ts",
    "+++ b/apps/autopilot/src/foo.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  assert.deepEqual(extractPatchPaths(patch), ["apps/autopilot/src/foo.ts"]);
});

test("assertBoundedSandboxPatch accepts a bounded autopilot source patch", () => {
  const patch = [
    "diff --git a/apps/autopilot/src/foo.ts b/apps/autopilot/src/foo.ts",
    "--- a/apps/autopilot/src/foo.ts",
    "+++ b/apps/autopilot/src/foo.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  assert.deepEqual(assertBoundedSandboxPatch(envelope, patch), ["apps/autopilot/src/foo.ts"]);
});

test("assertBoundedSandboxPatch rejects forbidden authority surfaces", () => {
  const patch = [
    "diff --git a/apps/autopilot/src/foo.ts b/apps/autopilot/src/foo.ts",
    "--- a/apps/autopilot/src/foo.ts",
    "+++ b/apps/autopilot/src/foo.ts",
    "@@ -1 +1 @@",
    "-const mode = 'safe';",
    "+const liveAuthority = 'FULL';",
  ].join("\n");
  assert.throws(() => assertBoundedSandboxPatch(envelope, patch), /SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE/);
});

test("assertBoundedSandboxPatch rejects forbidden paths", () => {
  const patch = [
    "diff --git a/apps/autopilot/src/index.ts b/apps/autopilot/src/index.ts",
    "--- a/apps/autopilot/src/index.ts",
    "+++ b/apps/autopilot/src/index.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  assert.throws(() => assertBoundedSandboxPatch(envelope, patch), /SANDBOX_PATCH_PATH_FORBIDDEN/);
});
