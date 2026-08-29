import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

export interface CodingBackendCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodingBackendCheckpoint {
  readonly backend: string;
  readonly workspaceId: string;
  readonly checkpointId: string;
}

export interface CodingBackend {
  readonly name: string;
  prepare(envelope: CodingExecutionEnvelope): Promise<{ readonly workspaceId: string }>;
  read(workspaceId: string, path: string): Promise<string>;
  write(workspaceId: string, path: string, content: string): Promise<void>;
  exec(workspaceId: string, argv: readonly string[]): Promise<CodingBackendCommandResult>;
  checkpoint(workspaceId: string): Promise<CodingBackendCheckpoint>;
  cleanup(workspaceId: string): Promise<void>;
}

export function assertSafeCodingEnvelope(envelope: CodingExecutionEnvelope): void {
  if (envelope.mutationAllowed !== false) throw new Error("CODING_BACKEND_MUTATION_AUTHORITY_FORBIDDEN");
  if (envelope.liveAuthority !== "NONE") throw new Error("CODING_BACKEND_LIVE_AUTHORITY_FORBIDDEN");
  if (envelope.productionMutationAllowed !== false) throw new Error("CODING_BACKEND_PRODUCTION_MUTATION_FORBIDDEN");
  if (envelope.aiAuthority !== "ZERO_AUTHORITY") throw new Error("CODING_BACKEND_AI_AUTHORITY_FORBIDDEN");
}
