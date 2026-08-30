import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodingBackend, CodingBackendCheckpoint, CodingBackendCommandResult } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";
import type { CodingRunnerRequest } from "./codingRunner";
import { SandboxCodingRuntime } from "./sandboxCodingRuntime";

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

const proposal = {
  patch: "diff --git a/apps/autopilot/src/example.ts b/apps/autopilot/src/example.ts\n--- a/apps/autopilot/src/example.ts\n+++ b/apps/autopilot/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
};

class FakeBackend implements CodingBackend {
  readonly name = "fake-sandbox";
  readonly commands: readonly string[][] = [];
  readonly writes: Array<{ path: string; content: string }> = [];
  preparedEnvelope: CodingExecutionEnvelope | null = null;
  cleaned = false;
  dirty = false;
  mismatchHead = false;

  async prepare(envelope: CodingExecutionEnvelope): Promise<{ readonly workspaceId: string }> {
    this.preparedEnvelope = envelope;
    return { workspaceId: "workspace-1" };
  }

  async read(_workspaceId: string, path: string): Promise<string> {
    return path === "apps/autopilot/src/example.ts" ? "new\n" : "";
  }
  async write(_workspaceId: string, path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
  }

  async exec(_workspaceId: string, argv: readonly string[]): Promise<CodingBackendCommandResult> {
    (this.commands as string[][]).push([...argv]);
    if (argv[0] === "git" && argv[1] === "rev-parse") {
      return { exitCode: 0, stdout: `${this.mismatchHead ? "b".repeat(40) : request.headSha}\n`, stderr: "" };
    }
    if (argv[0] === "git" && argv[1] === "status") {
      return { exitCode: 0, stdout: this.dirty ? " M apps/autopilot/src/index.ts\n" : "", stderr: "" };
    }
    if (argv[0] === "git" && argv[1] === "diff" && argv[2] === "--name-only") {
      return { exitCode: 0, stdout: "apps/autopilot/src/example.ts\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async checkpoint(): Promise<CodingBackendCheckpoint> {
    return { backend: this.name, workspaceId: "workspace-1", checkpointId: request.headSha };
  }

  async cleanup(): Promise<void> { this.cleaned = true; }
}

describe("sandbox coding runtime", () => {
  it("verifies exact-head clean workspace and preserves zero authority", async () => {
    const backend = new FakeBackend();
    const result = await new SandboxCodingRuntime(backend).execute(request);
    assert.deepEqual(result, { backend: "fake-sandbox", checkpointId: request.headSha, workspaceVerified: true });
    assert.equal(backend.preparedEnvelope?.baseSha, request.headSha);
    assert.equal(backend.preparedEnvelope?.mutationAllowed, false);
    assert.equal(backend.preparedEnvelope?.liveAuthority, "NONE");
    assert.equal(backend.preparedEnvelope?.productionMutationAllowed, false);
    assert.equal(backend.preparedEnvelope?.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(backend.cleaned, true);
  });

  it("validates a bounded AI proposal with the full sandbox gate and preserves exact file bytes", async () => {
    const backend = new FakeBackend();
    const result = await new SandboxCodingRuntime(backend).execute(request, proposal);
    assert.deepEqual(result, {
      backend: "fake-sandbox",
      checkpointId: request.headSha,
      workspaceVerified: true,
      proposalValidated: true,
      changedFiles: ["apps/autopilot/src/example.ts"],
      validatedFiles: [{ path: "apps/autopilot/src/example.ts", content: "new\n" }],
    });
    assert.equal(backend.preparedEnvelope?.allowedScope[0], "apps/autopilot/");
    assert.equal(backend.preparedEnvelope?.maxChangedFiles, 1);
    assert.equal(backend.writes[0]?.path, ".nusa-autopilot.patch");
    assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run build"));
    assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run architecture:check"));
    assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run safety:invariants"));
    assert.ok(backend.commands.some((argv) => argv.join(" ") === "pnpm run ai:architecture"));
    assert.equal(backend.cleaned, true);
  });

  it("rejects an AI proposal outside the bounded scope before sandbox preparation", async () => {
    const backend = new FakeBackend();
    const unsafe = {
      patch: "diff --git a/apps/desktop/src/example.ts b/apps/desktop/src/example.ts\n--- a/apps/desktop/src/example.ts\n+++ b/apps/desktop/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
    };
    await assert.rejects(() => new SandboxCodingRuntime(backend).execute(request, unsafe), /SANDBOX_PATCH_PATH_OUTSIDE_ALLOWED_SCOPE/);
    assert.equal(backend.preparedEnvelope, null);
    assert.equal(backend.cleaned, false);
  });

  it("fails closed on a mismatched checkout and still cleans up", async () => {
    const backend = new FakeBackend();
    backend.mismatchHead = true;
    await assert.rejects(() => new SandboxCodingRuntime(backend).execute(request), /CODING_RUNTIME_HEAD_MISMATCH/);
    assert.equal(backend.cleaned, true);
  });

  it("fails closed on a dirty workspace and still cleans up", async () => {
    const backend = new FakeBackend();
    backend.dirty = true;
    await assert.rejects(() => new SandboxCodingRuntime(backend).execute(request), /CODING_RUNTIME_WORKSPACE_DIRTY/);
    assert.equal(backend.cleaned, true);
  });
});
