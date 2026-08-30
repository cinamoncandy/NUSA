import type { CodingBackend } from "./codingBackend";
import { assertSafeCodingEnvelope } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";
import type { CodingRunnerRequest, CodingRuntime, CodingRuntimeExecutionResult } from "./codingRunner";

function toSandboxEnvelope(request: CodingRunnerRequest): CodingExecutionEnvelope {
  const envelope: CodingExecutionEnvelope = Object.freeze({
    cycleId: `runtime:${request.workflowRunId}`,
    workItemId: `sandbox-probe:${request.headSha}`,
    executionId: request.executionId,
    dedupeKey: request.dedupeKey,
    origin: "AUTO_BACKGROUND",
    repository: request.repository,
    baseSha: request.headSha,
    workflowRunId: request.workflowRunId,
    objective: "Verify a clean, exact-head cloud coding workspace before any repository edit is attempted.",
    acceptanceCriteria: [
      "Workspace HEAD matches the verified successful CI SHA.",
      "Workspace starts with no uncommitted changes.",
      "No LIVE or production authority is introduced.",
    ],
    evidenceRefs: [`github:workflow-run:${request.workflowRunId}`, `github:commit:${request.headSha}`],
    allowedScope: ["apps/autopilot/"],
    forbiddenScope: [".github/", "live-trading", "production-authority", "secrets"],
    maxChangedFiles: 1,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  assertSafeCodingEnvelope(envelope);
  return envelope;
}

export class SandboxCodingRuntime implements CodingRuntime {
  readonly name: string;

  constructor(private readonly backend: CodingBackend) {
    this.name = backend.name;
  }

  async execute(request: CodingRunnerRequest): Promise<CodingRuntimeExecutionResult> {
    const envelope = toSandboxEnvelope(request);
    const prepared = await this.backend.prepare(envelope);
    try {
      const head = await this.backend.exec(prepared.workspaceId, ["git", "rev-parse", "HEAD"]);
      if (head.exitCode !== 0 || head.stdout.trim().toLowerCase() !== request.headSha.toLowerCase()) {
        throw new Error("CODING_RUNTIME_HEAD_MISMATCH");
      }

      const status = await this.backend.exec(prepared.workspaceId, ["git", "status", "--porcelain"]);
      if (status.exitCode !== 0) throw new Error("CODING_RUNTIME_STATUS_FAILED");
      if (status.stdout.trim()) throw new Error("CODING_RUNTIME_WORKSPACE_DIRTY");

      const checkpoint = await this.backend.checkpoint(prepared.workspaceId);
      return Object.freeze({
        backend: this.backend.name,
        checkpointId: checkpoint.checkpointId,
        workspaceVerified: true as const,
      });
    } finally {
      await this.backend.cleanup(prepared.workspaceId);
    }
  }
}
