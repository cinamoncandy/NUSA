/**
 * "오늘" timeline for the 기록 screen (redesign 2026-10-19), from heartbeat timestamps and counters the server already sends.
 * Read-only: only events with a real, past, same-KST-day timestamp are listed; nothing is inferred or invented.
 */
export interface TimelineEvent { readonly at: number; readonly time: string; readonly text: string; readonly tone: "NOW" | "NORMAL" | "ATTENTION" | "MUTED" }

const KST = 9 * 3_600_000;
const kstDay = (ms: number) => Math.floor((ms + KST) / 86_400_000);
const hhmm = (ms: number) => { const d = new Date(ms + KST); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const ts = (v: unknown, now: number): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= now && kstDay(v) === kstDay(now) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function buildTodayTimeline(heartbeat: unknown, now: number): readonly TimelineEvent[] {
  if (heartbeat == null || typeof heartbeat !== "object" || Array.isArray(heartbeat) || !Number.isFinite(now)) return Object.freeze([]);
  const h = heartbeat as Record<string, unknown>;
  const events: TimelineEvent[] = [];
  const decided = ts(h.lastPaperDecisionAt, now);
  const decisions = int(h.windowDecisionCount) ?? int(h.decisionCount);
  if (decided != null) events.push({ at: decided, time: hhmm(decided), text: decisions == null ? "마지막 판단" : `마지막 판단 · 오늘 ${decisions.toLocaleString("en-US")}번째`, tone: "NOW" });
  const loss = h.lossLimit as Record<string, unknown> | undefined;
  const lossCount = int(loss?.consecutiveLossCount); const lossMax = int(loss?.maxConsecutiveLosses);
  const fill = ts(h.lastPaperFillAt, now);
  if (fill != null) events.push({ at: fill, time: hhmm(fill), text: lossCount != null && lossMax != null && lossCount >= lossMax ? `마지막 체결 · 지금 연속 손실 ${lossCount}/${lossMax}, 새 매수 멈춤` : "마지막 PAPER 체결", tone: lossCount != null && lossMax != null && lossCount >= lossMax ? "ATTENTION" : "NORMAL" });
  const started = ts(h.startedAt, now);
  if (started != null) events.push({ at: started, time: hhmm(started), text: "서버 시작 (오늘 숫자는 이때부터 세요)", tone: "MUTED" });
  return Object.freeze(events.sort((a, b) => b.at - a.at).map((e) => Object.freeze(e)));
}
