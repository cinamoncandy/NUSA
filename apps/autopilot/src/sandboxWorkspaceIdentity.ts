import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

const IDENTITY_VERSION = 2;

type WorkspaceIdentityInput = Pick<
  CodingExecutionEnvelope,
  "repository" | "baseSha" | "cycleId" | "workItemId" | "executionId" | "dedupeKey"
>;

export interface SandboxWorkspaceIdentity {
  readonly sandboxId: string;
  readonly root: string;
}

function canonicalIdentityInput(envelope: WorkspaceIdentityInput): string {
  return JSON.stringify({
    version: IDENTITY_VERSION,
    repository: envelope.repository,
    baseSha: envelope.baseSha.toLowerCase(),
    cycleId: envelope.cycleId,
    workItemId: envelope.workItemId,
    executionId: envelope.executionId,
    dedupeKey: envelope.dedupeKey,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Derives a collision-resistant identity without normalizing user-controlled execution IDs.
 * The digest is intentionally scoped to the repository and exact checkout so that two
 * otherwise similar executions cannot share a mutable sandbox workspace.
 */
export async function deriveSandboxWorkspaceIdentity(
  envelope: WorkspaceIdentityInput,
): Promise<SandboxWorkspaceIdentity> {
  const digest = await sha256Hex(canonicalIdentityInput(envelope));
  return Object.freeze({
    sandboxId: `task-${digest}`,
    root: `/workspace/nusa/${digest}`,
  });
}
