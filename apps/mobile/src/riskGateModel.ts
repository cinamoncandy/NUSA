/**
 * "Where did the flow stop?" for the Now screen (redesign 2026-10-19). When the server's consecutive-loss limit has stopped new
 * buys today, the honest reading is not "no execution" but "decisions run, buys wait at the risk gate". Read-only presentation:
 * it never decides, resets or hides the limit, and shows only counters the server sent (an unknown count is null, never 0).
 */
export interface RiskGateInput {
  /** From buildLossLimitLine: "STOPPED" only when today's consecutive losses reached the server's limit. */
  readonly lossLimitState: "STOPPED" | "WARNING" | "DISABLED" | null;
  readonly decisionCount: number | null;
  readonly paperOrderCount: number | null;
  readonly buySignalCount?: unknown;
  readonly buyBlockedCount?: unknown;
  /** From the server's lossLimit: today's consecutive losses and the limit, for the streak cells. */
  readonly consecutiveLossCount?: unknown;
  readonly maxConsecutiveLosses?: unknown;
}

export interface RiskGateModel {
  readonly headline: string;
  readonly detail: string;
  /** Buy signals that reached the gate and waited there; null when the server did not report it. */
  readonly waiting: number | null;
  readonly signals: number | null;
  /** Today's decision count (always known when the gate shows). */
  readonly decisions: number;
  /** Consecutive losses against the limit; null unless both are valid integers and the count reached the limit. */
  readonly streak: { readonly count: number; readonly max: number } | null;
}

const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

export function buildRiskGate(input: RiskGateInput): RiskGateModel | null {
  if (input.lossLimitState !== "STOPPED") return null;
  const decisions = count(input.decisionCount);
  if (decisions == null || decisions === 0 || count(input.paperOrderCount) !== 0) return null;
  const signals = count(input.buySignalCount);
  const waiting = count(input.buyBlockedCount);
  const lossCount = count(input.consecutiveLossCount);
  const lossMax = count(input.maxConsecutiveLosses);
  const streak = lossCount != null && lossMax != null && lossMax >= 1 && lossMax <= 20 && lossCount >= lossMax ? Object.freeze({ count: lossCount, max: lossMax }) : null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return Object.freeze({
    headline: "판단은 돌고 있어요\n새 매수는 위험 단계에서 멈춤",
    detail: waiting != null && waiting > 0 ? `매수 신호 ${fmt(waiting)}번이 문 앞에서 기다려요` : `판단 ${fmt(decisions)}번 · 새 주문 0건`,
    waiting,
    signals,
    decisions,
    streak,
  });
}
