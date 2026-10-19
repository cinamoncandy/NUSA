/**
 * "오늘" timeline for the 기록 screen (redesign 2026-10-19), from heartbeat timestamps and counters the server already sends.
 * Read-only: only events with a real, past, same-KST-day timestamp are listed; nothing is inferred or invented.
 */
export interface TimelineEvent { readonly at: number; readonly time: string; readonly text: string; readonly tone: "NOW" | "NORMAL" | "ATTENTION" | "MUTED" }

const KST = 9 * 3_600_000;
/** A decision older than this is shown as a past event, not as "지금". */
export const NOW_WINDOW_MS = 2 * 60_000;
const kstDay = (ms: number) => Math.floor((ms + KST) / 86_400_000);
const hhmm = (ms: number) => { const d = new Date(ms + KST); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const ts = (v: unknown, now: number): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= now && kstDay(v) === kstDay(now) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function buildTodayTimeline(heartbeat: unknown, now: number): readonly TimelineEvent[] {
  if (heartbeat == null || typeof heartbeat !== "object" || Array.isArray(heartbeat) || !Number.isFinite(now)) return Object.freeze([]);
  const h = heartbeat as Record<string, unknown>;
  const events: TimelineEvent[] = [];
  const decided = ts(h.lastPaperDecisionAt, now);
  if (decided != null) events.push({ at: decided, time: hhmm(decided), text: "마지막 판단", tone: now - decided <= NOW_WINDOW_MS ? "NOW" : "NORMAL" });
  const fill = ts(h.lastPaperFillAt, now);
  if (fill != null) events.push({ at: fill, time: hhmm(fill), text: "마지막 PAPER 체결", tone: "NORMAL" });
  // The loss limit is its own row, timed by the server's evaluation; it never claims which fill caused it.
  const loss = h.lossLimit as Record<string, unknown> | undefined;
  const lossCount = int(loss?.consecutiveLossCount); const lossMax = int(loss?.maxConsecutiveLosses); const lossAt = ts(loss?.evaluatedAt, now);
  if (lossAt != null && lossCount != null && lossMax != null && lossMax > 0 && lossCount >= lossMax && loss?.consecutiveLossLimitEnabled !== false) {
    events.push({ at: lossAt, time: hhmm(lossAt), text: `연속 손실 ${lossCount}/${lossMax} 확인 · 새 매수 멈춤`, tone: "ATTENTION" });
  }
  const started = ts(h.startedAt, now);
  if (started != null) events.push({ at: started, time: hhmm(started), text: "서버 시작", tone: "MUTED" });
  return Object.freeze(events.sort((a, b) => b.at - a.at).map((e) => Object.freeze(e)));
}
