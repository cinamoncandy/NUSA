/** One-line, read-only summary of how often the strategy said BUY in the current 09:00 KST window. Display only, no authority. */
export interface BuySignalLineInput {
  /** Server counts for the current 09:00 KST window, or null when the server does not report them. */
  readonly buySignals: number | null | undefined;
  /** BUY decisions the PAPER boundary explicitly refused (BLOCKED or REJECTED). */
  readonly buyBlocked: number | null | undefined;
  /** Epoch ms the counts start from (window start, or the runtime start if later). */
  readonly since: number | null | undefined;
}

export interface BuySignalLine {
  readonly value: string;
  readonly tone: "ok" | "warn" | "muted";
}

const KST_OFFSET_MS = 9 * 3_600_000;
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** "HH:MM" in KST for an epoch ms. */
function kstClock(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Unusable or missing input (older server, no PAPER boundary) reads as "not reported", never as zero. */
export function buildBuySignalLine(input: BuySignalLineInput): BuySignalLine {
  const signals = count(input.buySignals);
  const blocked = count(input.buyBlocked);
  if (signals == null || blocked == null) return Object.freeze({ value: "집계 미수신", tone: "muted" as const });
  const since = count(input.since);
  const from = since == null ? "" : ` (${kstClock(since)} 이후)`;
  if (signals === 0) return Object.freeze({ value: `없음${from}`, tone: "muted" as const });
  const refused = Math.min(blocked, signals);
  if (refused === 0) return Object.freeze({ value: `${signals}회${from}`, tone: "ok" as const });
  return Object.freeze({ value: `${signals}회 · 막힘 ${refused}회${from}`, tone: "warn" as const });
}
