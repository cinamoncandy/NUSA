/** One-line, read-only summary of how often the strategy said BUY today. Display only, no authority. */
export interface BuySignalLineInput {
  /** Counts since the last 09:00 KST, or null when the server does not report them or they are not loaded yet. */
  readonly buySignals: number | null;
  readonly buyBlocked: number | null;
  readonly paperOrders: number | null;
  /** Coded `STATUS:REASON` of the latest PAPER decision, shown only when a BUY was blocked. */
  readonly lastOutcome?: string | null;
}

export interface BuySignalLine {
  readonly value: string;
  readonly tone: "ok" | "warn" | "muted";
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Unusable or missing input reads as "not reported" (older server), never as zero. */
export function buildBuySignalLine(input: BuySignalLineInput): BuySignalLine {
  const signals = count(input.buySignals);
  const blocked = count(input.buyBlocked);
  if (signals == null || blocked == null) return Object.freeze({ value: "BUY 신호 집계 미수신", tone: "muted" as const });
  const orders = count(input.paperOrders);
  const ordered = orders == null ? "" : ` · 주문 ${orders}건`;
  if (signals === 0) return Object.freeze({ value: `오늘 BUY 신호 없음${ordered}`, tone: "muted" as const });
  const stopped = Math.min(blocked, signals);
  if (stopped === 0) return Object.freeze({ value: `BUY 신호 ${signals}회${ordered}`, tone: "ok" as const });
  return Object.freeze({ value: `BUY 신호 ${signals}회 · 주문 안 나간 ${stopped}회${ordered}`, tone: "warn" as const });
}
