import test from "node:test";
import assert from "node:assert/strict";
import { assertBoundedSandboxPatch } from "./sandboxPatchValidator";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

const base: CodingExecutionEnvelope = {
  cycleId: "cycle-1",
  workItemId: "work-1",
  executionId: "exec-1",
  dedupeKey: "dedupe-1",
  origin: "AUTO_BACKGROUND",
  repository: "cinamoncandy/NUSA",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  workflowRunId: 1,
  objective: "bounded repair",
  acceptanceCriteria: ["safe"],
  evidenceRefs: ["gha:1"],
  allowedScope: ["apps/autopilot/src"],
  forbiddenScope: [],
  maxChangedFiles: 1,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

test("sandbox patch validation enforces maxChangedFiles", () => {
  const patch = [
    "diff --git a/apps/autopilot/src/a.ts b/apps/autopilot/src/a.ts",
    "--- a/apps/autopilot/src/a.ts",
    "+++ b/apps/autopilot/src/a.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "diff --git a/apps/autopilot/src/b.ts b/apps/autopilot/src/b.ts",
    "--- a/apps/autopilot/src/b.ts",
    "+++ b/apps/autopilot/src/b.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n");
  assert.throws(() => assertBoundedSandboxPatch(base, patch), /SANDBOX_PATCH_FILE_COUNT_INVALID/);
});
