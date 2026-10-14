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

/**
 * `otherStopActive`: another stop (account halt, runtime halt, kill switch) is also in force. The midnight reset applies only
 * to the consecutive-loss limit, so the line then must not promise that buying restarts at midnight.
 */
export function buildLossLimitLine(lossLimit: unknown, now: number, otherStopActive = false): LossLimitLine | null {
  if (lossLimit == null || typeof lossLimit !== "object" || Array.isArray(lossLimit)) return null;
  const { consecutiveLossCount: count, maxConsecutiveLosses: max, evaluatedAt } = lossLimit as Record<string, unknown>;
  if (!isInt(count, 0) || !isInt(max, 1) || !isInt(evaluatedAt, 0) || !Number.isFinite(now)) return null;
  if (evaluatedAt > now || kstDay(evaluatedAt) !== kstDay(now)) return null;
  if (count >= max) {
    return Object.freeze({ state: "STOPPED", text: otherStopActive
      ? `오늘 연속 ${count}번 손실이라 새로 사지 않아요. 다른 정지 사유도 있어서 자정이 지나도 바로 다시 시작하지 않을 수 있어요.`
      : `오늘 연속 ${count}번 손실이라 새로 사지 않아요. 한국 시간 자정에 다시 시작해요.` });
  }
  if (max > 1 && count === max - 1) {
    return Object.freeze({ state: "WARNING", text: `오늘 연속 ${count}번 손실이에요. 한 번 더 손실이면 오늘은 새로 사지 않아요.` });
  }
  return null;
}

