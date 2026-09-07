import test from "node:test";
import assert from "node:assert/strict";
import type { CodingBackend, CodingBackendCheckpoint, CodingBackendCommandResult } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";
import { validatePatchInSandbox } from "./sandboxPatchValidator";

const envelope: CodingExecutionEnvelope = {
  cycleId: "cycle-1", workItemId: "work-1", executionId: "exec-1", dedupeKey: "dedupe-1",
  origin: "AUTO_BACKGROUND", repository: "cinamoncandy/NUSA",
  baseSha: "0123456789abcdef0123456789abcdef01234567", workflowRunId: 1,
  objective: "bounded repair", acceptanceCriteria: ["safe"], evidenceRefs: ["gha:1"],
  allowedScope: ["apps/autopilot/src"], forbiddenScope: [], maxChangedFiles: 1,
  mutationAllowed: false, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
};

class FailingBackend implements CodingBackend {
  readonly name = "failing";
  cleaned = false;
  async prepare() { return { workspaceId: "ws" }; }
  async read() { return ""; }
  async write() {}
  async exec(_workspaceId: string, argv: readonly string[]): Promise<CodingBackendCommandResult> {
    if (argv[0] === "git" && argv[1] === "apply" && argv[2] === "--check") return { exitCode: 1, stdout: "", stderr: "bad patch" };
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async checkpoint(): Promise<CodingBackendCheckpoint> { return { backend: this.name, workspaceId: "ws", checkpointId: "x" }; }
  async cleanup() { this.cleaned = true; }
}

test("sandbox workspace is cleaned after command failure", async () => {
  const backend = new FailingBackend();
  const patch = "diff --git a/apps/autopilot/src/a.ts b/apps/autopilot/src/a.ts\n--- a/apps/autopilot/src/a.ts\n+++ b/apps/autopilot/src/a.ts\n@@ -1 +1 @@\n-a\n+b";
  await assert.rejects(validatePatchInSandbox(backend, { envelope, patch }), /SANDBOX_PATCH_APPLY_CHECK_FAILED/);
  assert.equal(backend.cleaned, true);
});
