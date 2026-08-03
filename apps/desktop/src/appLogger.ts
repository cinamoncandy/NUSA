import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { LogLevel } from "./appSettingsStore";

/**
 * Application logging with a bound on how much disk it may ever occupy (WO-0034-A4O req 4).
 *
 * A desktop app that logs without rotation eventually fills a user's disk, and the failure
 * lands months after the code that caused it, on a machine nobody is watching. Three
 * independent bounds are applied, and the strictest one wins:
 *
 *   - per-file size, so one file stays readable and copyable;
 *   - file count, so a burst of errors cannot outrun the age bound;
 *   - age in days, so a quiet install does not keep last year's logs forever.
 *
 * MASKING IS APPLIED TO EVERY LINE, on the way in, never as a later cleanup pass. A log line
 * is durable the instant it is written: a masking step that runs at export time protects the
 * export and leaves the real secret on disk. This app has no credentials to leak today --
 * that is exactly why the masking has to already be here when someone adds a field that
 * looks like one.
 */

export type LogChannel = "MAIN" | "RENDERER" | "CRASH";

export interface LogRotationPolicy {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxAgeDays: number;
  /** Ceiling across all files, checked after the other two. */
  readonly maxTotalBytes: number;
}

export const DEFAULT_LOG_ROTATION: LogRotationPolicy = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 10,
  maxAgeDays: 14,
  maxTotalBytes: 20 * 1024 * 1024
});

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({ ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 });

/**
 * Patterns whose VALUE is replaced, never the key. Keeping the key visible means an operator
 * reading a masked log can still see that a field was present -- "accessKey=***" is a usable
 * fact, a silently deleted line is not.
 */
const SECRET_KEY_PATTERN = /("?\b(?:authorization|api[-_]?key|access[-_]?key|secret[-_]?key|secret|token|credential|password|passphrase|jwt)\b"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;
/** Long base64-ish runs and JWT-shaped strings, which is what a leaked key usually looks like. */
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;

export const LOG_REDACTION = "[REDACTED]";

/** Replaces secret-shaped values in a single line. Pure, so a test can drive it directly. */
export function maskSensitive(line: string): string {
  // Order matters. The key pattern stops at the first whitespace, so running it first on
  // `authorization: Bearer <token>` masks the word "Bearer" and leaves the token in the
  // clear. The token-shaped patterns therefore go first, and the key pattern mops up after.
  return line
    .replace(BEARER_PATTERN, (_match, scheme: string) => `${scheme} ${LOG_REDACTION}`)
    .replace(JWT_PATTERN, LOG_REDACTION)
    // The quoting is preserved so a masked JSON-ish line stays JSON-ish; a bare [REDACTED]
    // where a quoted string was makes the surrounding record unparseable.
    .replace(SECRET_KEY_PATTERN, (_match, prefix: string, value: string) => {
      const quote = value.startsWith("\"") ? "\"" : value.startsWith("'") ? "'" : "";
      return `${prefix}${quote}${LOG_REDACTION}${quote}`;
    });
}

export interface LogRecordInput {
  readonly channel: LogChannel;
  readonly level: LogLevel;
  readonly message: string;
  readonly errorCode?: string;
  readonly sessionId?: string | null;
  readonly runId?: string | null;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface LogRecord extends LogRecordInput {
  readonly timestamp: number;
}

/** Renders one line. Separate from writing so both the formatting and the masking are testable. */
export function formatLogLine(record: LogRecord): string {
  const detail = record.detail === undefined ? "" : ` ${JSON.stringify(record.detail)}`;
  const parts = [
    new Date(record.timestamp).toISOString(),
    record.level,
    record.channel,
    `run=${record.runId ?? "-"}`,
    `session=${record.sessionId ?? "-"}`,
    `code=${record.errorCode ?? "-"}`,
    record.message + detail
  ];
  return maskSensitive(parts.join(" | ").replace(/[\r\n]+/g, " "));
}

interface LogFile { readonly name: string; readonly fullPath: string; readonly bytes: number; readonly modifiedAt: number; }

function listLogFiles(directory: string): LogFile[] {
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".log"));
  } catch {
    return [];
  }
  const files: LogFile[] = [];
  for (const name of names) {
    const fullPath = path.join(directory, name);
    try {
      const stats = statSync(fullPath);
      files.push({ name, fullPath, bytes: stats.size, modifiedAt: stats.mtimeMs });
    } catch {
      // A file that vanished between listing and stat is simply not there to prune.
    }
  }
  return files.sort((left, right) => left.modifiedAt - right.modifiedAt);
}

/**
 * Decides which files to delete. Pure, given a listing and a clock, so the policy can be
 * tested without waiting fourteen days or writing twenty megabytes.
 */
export function selectExpiredLogFiles(files: readonly LogFile[], policy: LogRotationPolicy, now: number): readonly string[] {
  const ordered = [...files].sort((left, right) => left.modifiedAt - right.modifiedAt);
  const doomed = new Set<string>();
  const ageCutoff = now - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  for (const file of ordered) if (file.modifiedAt < ageCutoff) doomed.add(file.fullPath);
  // Oldest first for both remaining bounds: the newest logs are the ones a support request
  // is about, so they are the last to go.
  const surviving = () => ordered.filter((file) => !doomed.has(file.fullPath));
  let remaining = surviving();
  for (let index = 0; remaining.length - index > policy.maxFiles; index += 1) doomed.add(remaining[index]!.fullPath);
  remaining = surviving();
  let total = remaining.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of remaining) {
    if (total <= policy.maxTotalBytes) break;
    doomed.add(file.fullPath);
    total -= file.bytes;
  }
  return Object.freeze([...doomed]);
}

/**
 * How long a quiet logger may go without re-checking the age bound. Nothing but the passage
 * of time can break that bound, so a sweep this often is enough; the size and count bounds
 * are handled exactly, not on a timer (see `maybePrune`).
 */
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

export interface AppLoggerOptions {
  readonly directory: string;
  readonly policy?: LogRotationPolicy;
  readonly level?: LogLevel;
  readonly runId: string;
  readonly now?: () => number;
  /** Overridable so a test can drive the age sweep without waiting a minute. */
  readonly pruneIntervalMs?: number;
}

/** The file a channel is currently appending to, and how large we believe it to be. */
interface ActiveLogFile {
  readonly fullPath: string;
  readonly day: string;
  bytes: number;
}

export class AppLogger {
  private level: LogLevel;
  private readonly policy: LogRotationPolicy;
  private readonly now: () => number;
  private readonly directory: string;
  private readonly runId: string;
  private readonly pruneIntervalMs: number;
  private readonly active = new Map<LogChannel, ActiveLogFile>();
  /** Total on disk as measured by the last sweep, after its deletions. */
  private observedTotalBytes = 0;
  private bytesSincePrune = 0;
  private lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(options: AppLoggerOptions) {
    this.directory = options.directory;
    this.policy = options.policy ?? DEFAULT_LOG_ROTATION;
    this.level = options.level ?? "INFO";
    this.runId = options.runId;
    this.now = options.now ?? (() => Date.now());
    this.pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    mkdirSync(this.directory, { recursive: true });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  currentLevel(): LogLevel {
    return this.level;
  }

  /**
   * Crash lines go to their own file. A crash is what someone reads first, and mixing it into
   * a stream of routine INFO makes it something they have to search for.
   */
  private fileFor(channel: LogChannel, timestamp: number): string {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const prefix = channel === "CRASH" ? "crash" : "app";
    const base = path.join(this.directory, `${prefix}-${day}`);
    for (let part = 0; part < this.policy.maxFiles; part += 1) {
      const candidate = part === 0 ? `${base}.log` : `${base}.${part}.log`;
      try {
        if (statSync(candidate).size < this.policy.maxFileBytes) return candidate;
      } catch {
        return candidate;
      }
    }
    return `${base}.${this.policy.maxFiles - 1}.log`;
  }

  /**
   * Resolves the file to append to, reusing the last answer while it is still valid.
   *
   * `fileFor` stats up to `maxFiles` candidates, so calling it for every line made the cost of
   * writing a line scale with the number of files on disk. The answer only changes when the
   * day rolls over or the file fills, and both are things we can see from the byte count we
   * are already keeping, so it is now recomputed only at those two moments.
   */
  private resolveTarget(channel: LogChannel, timestamp: number): { file: ActiveLogFile; rolled: boolean } {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const current = this.active.get(channel);
    if (current !== undefined && current.day === day && current.bytes < this.policy.maxFileBytes) {
      return { file: current, rolled: false };
    }
    const fullPath = this.fileFor(channel, timestamp);
    let bytes = 0;
    try {
      // A previous run may have left this file part-written; start from its real size rather
      // than from zero, or the per-file bound would be measured from the wrong place.
      bytes = statSync(fullPath).size;
    } catch {
      bytes = 0;
    }
    const file: ActiveLogFile = { fullPath, day, bytes };
    this.active.set(channel, file);
    return { file, rolled: true };
  }

  log(input: LogRecordInput): void {
    // A CRASH line is written whatever the level is set to. A user who turned logging down
    // did not ask to lose the one record that explains why their app stopped.
    if (input.channel !== "CRASH" && LEVEL_RANK[input.level] > LEVEL_RANK[this.level]) return;
    const timestamp = this.now();
    const line = formatLogLine({ ...input, timestamp });
    const payload = `${line}\n`;
    const { file, rolled } = this.resolveTarget(input.channel, timestamp);
    try {
      mkdirSync(this.directory, { recursive: true });
      appendFileSync(file.fullPath, payload, "utf8");
    } catch {
      // Logging must never take the app down with it. A failed write is invisible by design:
      // there is nowhere left to report it to. The cached target is dropped so the next line
      // re-resolves rather than retrying a path that may no longer exist.
      this.active.delete(input.channel);
      return;
    }
    const written = Buffer.byteLength(payload, "utf8");
    file.bytes += written;
    this.bytesSincePrune += written;
    this.maybePrune(timestamp, rolled);
  }

  /**
   * Decides whether this line needs a full sweep of the directory.
   *
   * The sweep -- one readdir plus a stat per file -- used to run on every line, and measured
   * out at 55% of the total cost of logging. It is skipped when it provably cannot find
   * anything to delete, which is the case unless one of the three bounds could have moved:
   *
   *   - file count: can only rise when a new file is started, i.e. on a rollover;
   *   - total bytes: tracked exactly, from the last measured total plus what we have written
   *     since, so the ceiling is still enforced on the line that would cross it;
   *   - age: nothing we do can break it, only the clock can, hence the periodic sweep.
   *
   * So the bounds are unchanged. Only the number of times they are re-checked is.
   */
  private maybePrune(now: number, rolled: boolean): void {
    const overCeiling = this.observedTotalBytes + this.bytesSincePrune > this.policy.maxTotalBytes;
    if (!rolled && !overCeiling && now - this.lastPruneAt < this.pruneIntervalMs) return;
    this.prune();
  }

  prune(): readonly string[] {
    const files = listLogFiles(this.directory);
    const removed: string[] = [];
    for (const target of selectExpiredLogFiles(files, this.policy, this.now())) {
      try {
        rmSync(target, { force: true });
        removed.push(target);
      } catch {
        // Left in place; the next prune will try again.
      }
    }
    const deleted = new Set(removed);
    this.observedTotalBytes = files.reduce((sum, file) => (deleted.has(file.fullPath) ? sum : sum + file.bytes), 0);
    this.bytesSincePrune = 0;
    this.lastPruneAt = this.now();
    // A deleted file may be the one a channel was appending to, and appending to a path that
    // was just unlinked would silently recreate it outside the count. Re-resolve instead.
    for (const [channel, file] of this.active) if (deleted.has(file.fullPath)) this.active.delete(channel);
    return Object.freeze(removed);
  }

  /** Newest first, capped, for the diagnostics export. */
  recentFiles(limit = 5): readonly string[] {
    return Object.freeze(listLogFiles(this.directory).reverse().slice(0, limit).map((file) => file.fullPath));
  }

  diagnostics(): Readonly<{ directory: string; runId: string; level: LogLevel; policy: LogRotationPolicy; fileCount: number; totalBytes: number }> {
    const files = listLogFiles(this.directory);
    return Object.freeze({
      directory: this.directory,
      runId: this.runId,
      level: this.level,
      policy: this.policy,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
    });
  }
}
