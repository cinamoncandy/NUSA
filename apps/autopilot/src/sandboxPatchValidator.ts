import type { CodingBackend, CodingBackendCheckpoint } from "./codingBackend";
import { assertSafeCodingEnvelope } from "./codingBackend";
import type { CodingExecutionEnvelope } from "./codingExecutionEnvelope";

const MAX_PATCH_BYTES = 24_000;
const PATCH_PATH = ".nusa-autopilot.patch";

export interface SandboxPatchValidationRequest {
  readonly envelope: CodingExecutionEnvelope;
  readonly patch: string;
}

export interface SandboxPatchValidationResult {
  readonly status: "VALIDATED";
  readonly backend: string;
  readonly changedFiles: readonly string[];
  readonly checkpoint: CodingBackendCheckpoint;
}

function normalizeScope(scope: string): string {
  return scope.replace(/^\.\//, "").replace(/\/$/, "");
}

function isWithin(path: string, scope: string): boolean {
  const normalized = normalizeScope(scope);
  return path === normalized || path.startsWith(`${normalized}/`);
}

export function extractPatchPaths(patch: string): readonly string[] {
  const paths = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]!.trim());
  return [...new Set(paths)];
}

export function assertBoundedSandboxPatch(envelope: CodingExecutionEnvelope, patch: string): readonly string[] {
  assertSafeCodingEnvelope(envelope);
  if (!patch.trim()) throw new Error("SANDBOX_PATCH_REQUIRED");
  if (new TextEncoder().encode(patch).byteLength > MAX_PATCH_BYTES) throw new Error("SANDBOX_PATCH_TOO_LARGE");
  if (/liveAuthority|productionMutationAllowed|aiAuthority|NUSA_|wrangler|\.github\//i.test(patch)) {
    throw new Error("SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE");
  }

  const paths = extractPatchPaths(patch);
  if (paths.length === 0 || paths.length > envelope.maxChangedFiles) throw new Error("SANDBOX_PATCH_FILE_COUNT_INVALID");

  for (const path of paths) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`SANDBOX_PATCH_PATH_INVALID:${path}`);
    if (!envelope.allowedScope.some((scope) => isWithin(path, scope))) throw new Error(`SANDBOX_PATCH_PATH_OUTSIDE_ALLOWED_SCOPE:${path}`);
    if (envelope.forbiddenScope.some((scope) => isWithin(path, scope))) throw new Error(`SANDBOX_PATCH_PATH_FORBIDDEN:${path}`);
  }
  return paths;
}

async function mustExec(backend: CodingBackend, workspaceId: string, argv: readonly string[], label: string): Promise<string> {
  const result = await backend.exec(workspaceId, argv);
  if (result.exitCode !== 0) throw new Error(`${label}:${result.exitCode}:${result.stderr.slice(-1200)}`);
  return result.stdout;
}

export async function validatePatchInSandbox(
  backend: CodingBackend,
  request: SandboxPatchValidationRequest,
): Promise<SandboxPatchValidationResult> {
  const expectedPaths = assertBoundedSandboxPatch(request.envelope, request.patch);
  const prepared = await backend.prepare(request.envelope);
  const workspaceId = prepared.workspaceId;

  try {
    await backend.write(workspaceId, PATCH_PATH, `${request.patch.trim()}\n`);
    await mustExec(backend, workspaceId, ["git", "apply", "--check", PATCH_PATH], "SANDBOX_PATCH_APPLY_CHECK_FAILED");
    await mustExec(backend, workspaceId, ["git", "apply", PATCH_PATH], "SANDBOX_PATCH_APPLY_FAILED");
    await mustExec(backend, workspaceId, ["git", "diff", "--check"], "SANDBOX_PATCH_DIFF_CHECK_FAILED");

    const changed = (await mustExec(backend, workspaceId, ["git", "diff", "--name-only"], "SANDBOX_PATCH_DIFF_LIST_FAILED"))
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const changedFiles = [...new Set(changed)];
    if (changedFiles.length !== expectedPaths.length || changedFiles.some((path) => !expectedPaths.includes(path))) {
      throw new Error("SANDBOX_PATCH_CHANGED_FILES_MISMATCH");
    }

    await mustExec(backend, workspaceId, ["pnpm", "install", "--frozen-lockfile"], "SANDBOX_INSTALL_FAILED");
    await mustExec(backend, workspaceId, ["pnpm", "run", "build"], "SANDBOX_BUILD_FAILED");
    await mustExec(backend, workspaceId, ["pnpm", "run", "architecture:check"], "SANDBOX_ARCHITECTURE_FAILED");
    await mustExec(backend, workspaceId, ["pnpm", "run", "safety:invariants"], "SANDBOX_SAFETY_FAILED");
    await mustExec(backend, workspaceId, ["pnpm", "run", "ai:architecture"], "SANDBOX_AI_ARCHITECTURE_FAILED");

    const checkpoint = await backend.checkpoint(workspaceId);
    return { status: "VALIDATED", backend: backend.name, changedFiles, checkpoint };
  } finally {
    await backend.cleanup(workspaceId);
  }
}
