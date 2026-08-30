import test from "node:test";
import assert from "node:assert/strict";
import type { CodingBackend, CodingBackendCheckpoint, CodingBackendCommandResult } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";
import { validatePatchInSandbox } from "./sandboxPatchValidator";

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
  forbiddenScope: [],
  maxChangedFiles: 3,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

class FakeBackend implements CodingBackend {
  readonly name = "fake-sandbox";
  readonly commands: string[][] = [];
  cleaned = false;

  async prepare(): Promise<{ readonly workspaceId: string }> { return { workspaceId: "ws-1" }; }
  async read(): Promise<string> { return ""; }
  async write(): Promise<void> {}
  async exec(_workspaceId: string, argv: readonly string[]): Promise<CodingBackendCommandResult> {
    this.commands.push([...argv]);
    if (argv[0] === "git" && argv[1] === "diff" && argv[2] === "--name-only") {
      return { exitCode: 0, stdout: "apps/autopilot/src/foo.ts\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async checkpoint(): Promise<CodingBackendCheckpoint> {
    return { backend: this.name, workspaceId: "ws-1", checkpointId: envelope.baseSha };
  }
  async cleanup(): Promise<void> { this.cleaned = true; }
}

test("validatePatchInSandbox applies, validates, checkpoints, and cleans up", async () => {
  const backend = new FakeBackend();
  const patch = [
    "diff --git a/apps/autopilot/src/foo.ts b/apps/autopilot/src/foo.ts",
    "--- a/apps/autopilot/src/foo.ts",
    "+++ b/apps/autopilot/src/foo.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");

  const result = await validatePatchInSandbox(backend, { envelope, patch });
  assert.equal(result.status, "VALIDATED");
  assert.deepEqual(result.changedFiles, ["apps/autopilot/src/foo.ts"]);
  assert.equal(backend.cleaned, true);
  assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run build"));
  assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run safety:invariants"));
});
