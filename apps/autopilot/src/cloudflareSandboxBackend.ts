import { getSandbox } from "@cloudflare/sandbox";
import { assertSafeCodingEnvelope, type CodingBackend, type CodingBackendCheckpoint, type CodingBackendCommandResult } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

type SandboxNamespace = Parameters<typeof getSandbox>[0];
type SandboxCommand = Parameters<ReturnType<typeof getSandbox>["exec"]>[0];

interface WorkspaceRef {
  readonly sandboxId: string;
  readonly root: string;
}

const BACKEND_NAME = "cloudflare-sandbox";
const WORKSPACE_PREFIX = "nusa-sbx-v1";
const REPOSITORY = "https://github.com/cinamoncandy/NUSA.git";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
}

function encodeWorkspace(ref: WorkspaceRef): string {
  return `${WORKSPACE_PREFIX}:${ref.sandboxId}:${ref.root}`;
}

function decodeWorkspace(workspaceId: string): WorkspaceRef {
  const [prefix, sandboxId, ...rootParts] = workspaceId.split(":");
  const root = rootParts.join(":");
  if (prefix !== WORKSPACE_PREFIX || !sandboxId || !root.startsWith("/workspace/nusa/")) {
    throw new Error("INVALID_SANDBOX_WORKSPACE_ID");
  }
  return { sandboxId, root };
}

function assertRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("INVALID_SANDBOX_PATH");
}

function asSandboxCommand(argv: readonly string[]): SandboxCommand {
  if (argv.length === 0) throw new Error("SANDBOX_EXEC_ARGV_REQUIRED");
  return [argv[0]!, ...argv.slice(1)] as SandboxCommand;
}

export class CloudflareSandboxBackend implements CodingBackend {
  readonly name = BACKEND_NAME;

  constructor(private readonly namespace: SandboxNamespace) {}

  async prepare(envelope: CodingExecutionEnvelope): Promise<{ readonly workspaceId: string }> {
    assertSafeCodingEnvelope(envelope);
    const sandboxId = safeSegment(`task-${envelope.executionId}`);
    const root = `/workspace/nusa/${safeSegment(envelope.executionId)}`;
    const sandbox = getSandbox(this.namespace, sandboxId);
    const launch = await sandbox.exec([
      "/bin/bash",
      "-lc",
      `set -euo pipefail; rm -rf "$1"; git clone --no-checkout "$2" "$1"; git -C "$1" checkout --detach "$3"`,
      "nusa-prepare",
      root,
      REPOSITORY,
      envelope.baseSha,
    ]);
    const result = await launch.output({ encoding: "utf8" });
    if (result.exitCode !== 0) throw new Error(`SANDBOX_PREPARE_FAILED:${result.exitCode}`);
    return { workspaceId: encodeWorkspace({ sandboxId, root }) };
  }

  async read(workspaceId: string, path: string): Promise<string> {
    assertRelativePath(path);
    const ref = decodeWorkspace(workspaceId);
    const file = await getSandbox(this.namespace, ref.sandboxId).readFile(`${ref.root}/${path}`, { encoding: "utf-8" });
    if (typeof file.content !== "string") throw new Error("SANDBOX_READ_TEXT_REQUIRED");
    return file.content;
  }

  async write(workspaceId: string, path: string, content: string): Promise<void> {
    assertRelativePath(path);
    const ref = decodeWorkspace(workspaceId);
    await getSandbox(this.namespace, ref.sandboxId).writeFile(`${ref.root}/${path}`, content);
  }

  async exec(workspaceId: string, argv: readonly string[]): Promise<CodingBackendCommandResult> {
    const ref = decodeWorkspace(workspaceId);
    const process = await getSandbox(this.namespace, ref.sandboxId).exec(asSandboxCommand(argv), { cwd: ref.root });
    const result = await process.output({ encoding: "utf8" });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async checkpoint(workspaceId: string): Promise<CodingBackendCheckpoint> {
    const ref = decodeWorkspace(workspaceId);
    const process = await getSandbox(this.namespace, ref.sandboxId).exec(["git", "rev-parse", "HEAD"], { cwd: ref.root });
    const result = await process.output({ encoding: "utf8" });
    if (result.exitCode !== 0) throw new Error("SANDBOX_CHECKPOINT_FAILED");
    return { backend: BACKEND_NAME, workspaceId, checkpointId: result.stdout.trim() };
  }

  async cleanup(workspaceId: string): Promise<void> {
    const ref = decodeWorkspace(workspaceId);
    const process = await getSandbox(this.namespace, ref.sandboxId).exec(["rm", "-rf", ref.root]);
    await process.output({ encoding: "utf8" });
  }
}

export type CloudflareSandboxNamespace = SandboxNamespace;
