import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { freemem, setPriority } from "node:os";
import path from "node:path";

/**
 * On-demand Research snapshot refresh for the PAPER runtime.
 *
 * The closed-learning bootstrap can only deploy a challenger from a Research snapshot that replays
 * under the running release. After a release that changes Research/League semantics the stored
 * snapshot is stale, and the daily Research timer is the only producer, so PAPER trading would sit
 * without a strategy for up to a day. When the bootstrap reports that it is waiting for a snapshot,
 * this runs the exact same canonical Research entrypoint the timer runs (same user, environment and
 * paths), in the background, at most once per interval and never concurrently.
 *
 * It grants nothing: the new snapshot still goes through the unchanged replay, qualification and
 * Governance path before any PAPER_RESEARCH_ONLY deployment. A failed refresh is recorded and the
 * runtime keeps running.
 */
export const RESEARCH_REFRESH_RECORD_FILE = "research-refresh-last-attempt.json";
export const RESEARCH_REFRESH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/**
 * The Oracle PAPER host has 1 GB of RAM shared with the PAPER runtime, the autopilot service and
 * the GitHub runners. A refresh starts only with this much free memory, its whole process tree is
 * capped by NODE_OPTIONS, and it runs at the lowest CPU priority, so it cannot starve the host.
 */
export const RESEARCH_REFRESH_MIN_FREE_MEMORY_BYTES = 600 * 1024 * 1024;
export const RESEARCH_REFRESH_HEAP_LIMIT_MB = 256;

export interface ResearchSnapshotRefresherOptions {
  readonly cloudStateDbPath: string;
  readonly cwd?: string;
  readonly executable?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
  readonly spawn?: (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "ignore" }) => Pick<ChildProcess, "on" | "kill">;
  readonly log?: (line: string) => void;
  readonly freeMemoryBytes?: () => number;
  readonly lowerPriority?: (pid: number) => void;
}

export type ResearchRefreshRequestOutcome = "STARTED" | "RUNNING" | "NOT_DUE" | "LOW_MEMORY" | "UNAVAILABLE";

function withHeapLimit(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existing = (env.NODE_OPTIONS ?? "").replace(/--max-old-space-size=\S+/g, "").trim();
  return { ...env, NODE_OPTIONS: `${existing} --max-old-space-size=${RESEARCH_REFRESH_HEAP_LIMIT_MB}`.trim() };
}

export class ResearchSnapshotRefresher {
  private running: Pick<ChildProcess, "on" | "kill"> | undefined;
  private stopped = false;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly recordPath: string | undefined;

  public constructor(private readonly options: ResearchSnapshotRefresherOptions) {
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? RESEARCH_REFRESH_MIN_INTERVAL_MS;
    const db = options.cloudStateDbPath.trim();
    this.recordPath = db && db !== ":memory:" && path.isAbsolute(db) ? path.join(path.dirname(db), RESEARCH_REFRESH_RECORD_FILE) : undefined;
  }

  /** Non-blocking; never throws. */
  public requestIfDue(): ResearchRefreshRequestOutcome {
    if (this.stopped || this.recordPath == null) return "UNAVAILABLE";
    if (this.running != null) return "RUNNING";
    const now = this.now();
    const last = this.lastAttemptAt();
    if (last != null && now >= last && now - last < this.minIntervalMs) return "NOT_DUE";
    // Not recorded as an attempt: the next poll retries once memory is available again.
    if ((this.options.freeMemoryBytes ?? freemem)() < RESEARCH_REFRESH_MIN_FREE_MEMORY_BYTES) return "LOW_MEMORY";
    try {
      this.writeRecord({ schemaVersion: 1, attemptedAt: now, status: "STARTED" });
      const cwd = this.options.cwd ?? process.cwd();
      const child = (this.options.spawn ?? nodeSpawn)(
        this.options.executable ?? process.execPath,
        [path.join(cwd, "scripts", "run-cloud-research-snapshot.js")],
        { cwd, env: withHeapLimit(this.options.env ?? process.env), stdio: "ignore" },
      );
      this.running = child;
      const pid = (child as { pid?: number }).pid;
      if (pid != null) {
        try { (this.options.lowerPriority ?? ((value: number) => setPriority(value, 19)))(pid); } catch { /* best effort */ }
      }
      child.on("error", () => this.finish(now, "FAILED_TO_START"));
      child.on("exit", (code: number | null) => this.finish(now, code === 0 ? "COMPLETED" : "FAILED"));
      this.options.log?.("[closed-learning] Research snapshot is missing or stale; started one canonical Research refresh");
      return "STARTED";
    } catch {
      this.running = undefined;
      this.finish(now, "FAILED_TO_START");
      return "UNAVAILABLE";
    }
  }

  public stop(): void {
    this.stopped = true;
    try { this.running?.kill("SIGTERM"); } catch { /* best effort */ }
    this.running = undefined;
  }

  private finish(attemptedAt: number, status: "COMPLETED" | "FAILED" | "FAILED_TO_START"): void {
    this.running = undefined;
    this.writeRecord({ schemaVersion: 1, attemptedAt, status, finishedAt: this.now() });
    this.options.log?.(`[closed-learning] Research refresh ${status.toLowerCase()}`);
  }

  private lastAttemptAt(): number | undefined {
    if (this.recordPath == null || !existsSync(this.recordPath)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(this.recordPath, "utf8")) as Record<string, unknown>;
      return parsed.schemaVersion === 1 && Number.isSafeInteger(parsed.attemptedAt) ? parsed.attemptedAt as number : undefined;
    } catch {
      return undefined;
    }
  }

  private writeRecord(record: Record<string, unknown>): void {
    if (this.recordPath == null) return;
    try {
      const temporary = `${this.recordPath}.tmp`;
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
      renameSync(temporary, this.recordPath);
    } catch { /* a missing record only means the next request may run sooner */ }
  }
}
