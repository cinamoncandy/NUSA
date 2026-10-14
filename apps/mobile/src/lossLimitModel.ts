/**
 * Owner-facing line for the PAPER consecutive-loss limit, from the display-only heartbeat value the server sends.
 *
 * Read-only presentation: it never decides, resets or hides the limit. The server's count covers only today's
 * trading day (Asia/Seoul), so an evaluation from an earlier KST day is not shown. Dependency-free on purpose.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDay = (ms: number): number => Math.floor((ms + KST_OFFSET_MS) / 86_400_000);
const isInt = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

export interface LossLimitLine {
  /** "STOPPED" when today's consecutive losses reached the limit; "WARNING" one loss before it. */
  readonly state: "STOPPED" | "WARNING";
  readonly text: string;
}

export function buildLossLimitLine(lossLimit: unknown, now: number): LossLimitLine | null {
  if (lossLimit == null || typeof lossLimit !== "object" || Array.isArray(lossLimit)) return null;
  const { consecutiveLossCount: count, maxConsecutiveLosses: max, evaluatedAt } = lossLimit as Record<string, unknown>;
  if (!isInt(count, 0) || !isInt(max, 1) || !isInt(evaluatedAt, 0) || !Number.isFinite(now)) return null;
  if (evaluatedAt > now || kstDay(evaluatedAt) !== kstDay(now)) return null;
  if (count >= max) {
    return Object.freeze({ state: "STOPPED", text: `오늘 연속 ${count}번 손실이라 새로 사지 않아요. 한국 시간 자정에 다시 시작해요.` });
  }
  if (max > 1 && count === max - 1) {
    return Object.freeze({ state: "WARNING", text: `오늘 연속 ${count}번 손실이에요. 한 번 더 손실이면 오늘은 새로 사지 않아요.` });
  }
  return null;
}

export interface TodayRealizedLine {
  readonly tone: "GAIN" | "LOSS" | "FLAT";
  readonly text: string;
}

/** Today's realized (closed-trade) PAPER P&L in KRW; null when missing, malformed, future or from an earlier KST day. */
export function buildTodayRealizedLine(todayRealized: unknown, now: number): TodayRealizedLine | null {
  if (todayRealized == null || typeof todayRealized !== "object" || Array.isArray(todayRealized)) return null;
  const { realizedPnlKrw: pnl, evaluatedAt } = todayRealized as Record<string, unknown>;
  if (typeof pnl !== "number" || !Number.isFinite(pnl) || !isInt(evaluatedAt, 0) || !Number.isFinite(now)) return null;
  if (evaluatedAt > now || kstDay(evaluatedAt) !== kstDay(now)) return null;
  const won = Math.round(pnl);
  const amount = Math.abs(won).toLocaleString("ko-KR");
  if (won === 0) return Object.freeze({ tone: "FLAT", text: "오늘 확정 손익 0원" });
  return Object.freeze({ tone: won > 0 ? "GAIN" : "LOSS", text: `오늘 확정 손익 ${won > 0 ? "+" : "-"}${amount}원` });
}
