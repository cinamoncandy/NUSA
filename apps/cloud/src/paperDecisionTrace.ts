/**
 * Display only: decisions and PAPER orders per 5 minutes across the current 09:00 KST window (= 00:00 UTC), kept in memory.
 * The app draws today's decision terrain from it. It is never read by strategy, RISK or execution, and it restarts empty with the
 * runtime: buckets before `since` were not observed by this process and must not be shown as zero.
 */
export const DECISION_TRACE_BUCKET_MS = 300_000;
export const DECISION_TRACE_BUCKETS = 288;

export interface PaperDecisionTraceSnapshot {
  readonly since: number;
  readonly bucketMs: number;
  readonly decisions: readonly number[];
  readonly orders: readonly number[];
}

export class PaperDecisionTrace {
  private windowStart: number;
  private since: number;
  private decisions = new Array<number>(DECISION_TRACE_BUCKETS).fill(0);
  private orders = new Array<number>(DECISION_TRACE_BUCKETS).fill(0);

  constructor(private readonly windowMs: number, startedAt: number) {
    this.windowStart = Math.floor(startedAt / windowMs) * windowMs;
    this.since = startedAt;
  }

  record(kind: "decision" | "order", count: number, nowMs: number): void {
    if (!Number.isSafeInteger(count) || count <= 0) return;
    this.roll(nowMs);
    const index = Math.floor((nowMs - this.windowStart) / DECISION_TRACE_BUCKET_MS);
    if (index < 0 || index >= DECISION_TRACE_BUCKETS) return;
    const target = kind === "decision" ? this.decisions : this.orders;
    target[index] = (target[index] ?? 0) + count;
  }

  snapshot(nowMs: number): PaperDecisionTraceSnapshot {
    this.roll(nowMs);
    return Object.freeze({ since: Math.max(this.since, this.windowStart), bucketMs: DECISION_TRACE_BUCKET_MS, decisions: Object.freeze([...this.decisions]), orders: Object.freeze([...this.orders]) });
  }

  private roll(nowMs: number): void {
    const start = Math.floor(nowMs / this.windowMs) * this.windowMs;
    if (start === this.windowStart) return;
    this.windowStart = start;
    this.since = start;
    this.decisions.fill(0);
    this.orders.fill(0);
  }
}
