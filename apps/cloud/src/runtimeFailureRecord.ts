import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Restart forensics for the supervised PAPER runtime. When a fail-closed stop or a fatal fault ends
 * the process, the reason is written beside the durable Cloud state so the next process can report
 * it through the public `/health` `lastError` field. Without it a crash loop is invisible: every
 * restart starts with a clean in-memory heartbeat.
 *
 * Only a bare code derived from the message is kept, never free text, so nothing beyond what the
 * existing public liveness error allowlist accepts can reach `/health`. Recording is best-effort and
 * never changes the fail-closed outcome.
 */
export const RUNTIME_FAILURE_RECORD_FILE = "runtime-last-failure.json";
export type RuntimeFailureKind = "CLOSED_LEARNING_SCHEDULER" | "UNCAUGHT_EXCEPTION" | "UNHANDLED_REJECTION";

const MAX_CODE_LENGTH = 120;

export function runtimeFailureRecordPath(cloudStateDbPath: string): string | undefined {
  const normalized = cloudStateDbPath.trim();
  if (!normalized || normalized === ":memory:" || !path.isAbsolute(normalized)) return undefined;
  return path.join(path.dirname(normalized), RUNTIME_FAILURE_RECORD_FILE);
}

/** Reduces an error message to an uppercase code: long hex/digit runs and path-like tokens are dropped. */
export function runtimeFailureCode(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  const code = message
    .replace(/\S*[/\\]\S*/g, " ")
    .replace(/\b[0-9a-f]{12,}\b/gi, " ")
    .replace(/\d{4,}/g, " ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_CODE_LENGTH)
    .replace(/_+$/, "");
  return code || "UNKNOWN";
}

export function recordRuntimeFailure(cloudStateDbPath: string, kind: RuntimeFailureKind, reason: unknown, now: number = Date.now()): void {
  const file = runtimeFailureRecordPath(cloudStateDbPath);
  if (file == null) return;
  try {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, kind, code: runtimeFailureCode(reason), at: now }), { mode: 0o600 });
    renameSync(temporary, file);
  } catch { /* forensics must never mask the original fault */ }
}

/** `PREVIOUS_<KIND>:<CODE>` for the last recorded failure, or undefined when none is readable. */
export function readPreviousRuntimeFailure(cloudStateDbPath: string): string | undefined {
  const file = runtimeFailureRecordPath(cloudStateDbPath);
  if (file == null || !existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const kind = parsed.kind;
    if (parsed.schemaVersion !== 1 || (kind !== "CLOSED_LEARNING_SCHEDULER" && kind !== "UNCAUGHT_EXCEPTION" && kind !== "UNHANDLED_REJECTION")) return undefined;
    const code = typeof parsed.code === "string" && /^[A-Z0-9_]{1,120}$/.test(parsed.code) ? parsed.code : "UNKNOWN";
    return `PREVIOUS_${kind}:${code}`;
  } catch {
    return undefined;
  }
}
