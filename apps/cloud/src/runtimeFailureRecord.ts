import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Restart forensics for the supervised PAPER runtime. When a fail-closed stop or a fatal fault ends
 * the process, the reason is written beside the durable Cloud state so the next process can report
 * it through the public `/health` `lastError` field. Without it a crash loop is invisible: every
 * restart starts with a clean in-memory heartbeat.
 *
 * No free text is ever kept: a message that already is a bare internal code (for example
 * PAPER_WRITER_LEASE_LOST) is kept as is, and any other message is reduced to a SHA-256 fingerprint
 * that operators match against the source messages offline. Recording is best-effort and never
 * changes the fail-closed outcome.
 */
export const RUNTIME_FAILURE_RECORD_FILE = "runtime-last-failure.json";
export type RuntimeFailureKind = "STARTUP" | "CLOSED_LEARNING_SCHEDULER" | "UNCAUGHT_EXCEPTION" | "UNHANDLED_REJECTION";
const KINDS: readonly string[] = ["STARTUP", "CLOSED_LEARNING_SCHEDULER", "UNCAUGHT_EXCEPTION", "UNHANDLED_REJECTION"];
const BARE_CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

export function runtimeFailureRecordPath(cloudStateDbPath: string): string | undefined {
  const normalized = cloudStateDbPath.trim();
  if (!normalized || normalized === ":memory:" || !path.isAbsolute(normalized)) return undefined;
  return path.join(path.dirname(normalized), RUNTIME_FAILURE_RECORD_FILE);
}

/** A bare internal code is kept; any other message becomes MESSAGE_<first 12 hex of its SHA-256>. */
export function runtimeFailureCode(reason: unknown): string {
  const message = (reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "").trim();
  if (!message) return "UNKNOWN";
  if (BARE_CODE.test(message)) return message;
  return `MESSAGE_${createHash("sha256").update(message).digest("hex").slice(0, 12).toUpperCase()}`;
}

/** Only bounded internal causes are persisted; SQL messages, owners and paths are excluded. */
export function runtimeFailureCauseCode(reason: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = reason;
  let result: string | undefined;
  for (let depth = 0; depth < 4 && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    if (/^PAPER_WRITER_(?:CLOCK_INVALID|CLOCK_REGRESSION|CLOCK_ANOMALY|LEASE_EXPIRED|LEASE_OWNER_MISMATCH|LEASE_ROW_MISSING|LEASE_RENEWAL_REJECTED)$/.test(current.message)) result = current.message;
    const errcode = (current as Error & { errcode?: unknown }).errcode;
    if (typeof errcode === "number" && Number.isSafeInteger(errcode) && errcode >= 0) {
      const sqliteCodes: Readonly<Record<number, string>> = { 5: "SQLITE_BUSY", 6: "SQLITE_LOCKED", 8: "SQLITE_READONLY", 10: "SQLITE_IOERR", 13: "SQLITE_FULL" };
      result = sqliteCodes[errcode & 255] ?? result;
    }
    current = current.cause;
  }
  return result;
}

export function recordRuntimeFailure(cloudStateDbPath: string, kind: RuntimeFailureKind, reason: unknown, now: number = Date.now()): void {
  const file = runtimeFailureRecordPath(cloudStateDbPath);
  if (file == null) return;
  try {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, kind, code: runtimeFailureCode(reason), at: now, causeCode: runtimeFailureCauseCode(reason) }), { mode: 0o600 });
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
    if (parsed.schemaVersion !== 1 || typeof kind !== "string" || !KINDS.includes(kind)) return undefined;
    const code = typeof parsed.code === "string" && (BARE_CODE.test(parsed.code) || /^MESSAGE_[0-9A-F]{12}$/.test(parsed.code)) ? parsed.code : "UNKNOWN";
    return `PREVIOUS_${kind}:${code}`;
  } catch {
    return undefined;
  }
}
