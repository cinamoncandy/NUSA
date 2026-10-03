/** One-line, read-only summary of how steady the public market feed was in the current 09:00 KST window. Display only. */
export interface FeedDiagnosticsInput {
  readonly disconnects: number | null | undefined;
  /** Gaps between ticker events longer than the 30 s stale window. */
  readonly staleGaps: number | null | undefined;
  readonly maxGapMs: number | null | undefined;
  /** Epoch ms the counts start from (window start, or the runtime start if later). */
  readonly since: number | null | undefined;
}

export interface FeedDiagnosticsLine {
  readonly value: string;
  readonly tone: "ok" | "warn" | "muted";
}

const KST_OFFSET_MS = 9 * 3_600_000;
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function kstClock(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function seconds(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}초` : `${Math.round(s)}초`;
}

/** Missing or unusable input (older server, public feed off) reads as "not reported", never as a clean feed. */
export function buildFeedDiagnosticsLine(input: FeedDiagnosticsInput): FeedDiagnosticsLine {
  const disconnects = count(input.disconnects);
  const staleGaps = count(input.staleGaps);
  const maxGap = count(input.maxGapMs);
  if (disconnects == null || staleGaps == null || maxGap == null) return Object.freeze({ value: "집계 미수신", tone: "muted" as const });
  const sinceMs = count(input.since);
  const from = sinceMs == null ? "" : ` (${kstClock(sinceMs)} 이후)`;
  if (disconnects === 0 && staleGaps === 0) return Object.freeze({ value: `끊김 없음 · 최대 공백 ${seconds(maxGap)}${from}`, tone: "ok" as const });
  return Object.freeze({ value: `끊김 ${disconnects}회 · 30초+ 공백 ${staleGaps}회 · 최대 ${seconds(maxGap)}${from}`, tone: "warn" as const });
}
