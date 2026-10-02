/** Daily 09:00 KST (00:00 UTC) reset for the HOME decision/order counters. Display only. */
export const DAILY_RESET_UTC_HOUR = 0;
const DAY_MS = 86_400_000;

export interface DailyBaseline {
  readonly dayKey: number;
  readonly decisionBase: number;
  readonly orderBase: number;
}

/** Index of the 09:00 KST window containing `nowMs`. */
export function resetDayKey(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

export function nextDailyBaseline(prev: DailyBaseline | null, decisionCount: number, orderCount: number, nowMs: number): DailyBaseline {
  const dayKey = resetDayKey(nowMs);
  // A new window, or a server counter that went backwards (restart), starts a fresh baseline.
  if (prev == null || prev.dayKey !== dayKey || decisionCount < prev.decisionBase || orderCount < prev.orderBase) {
    return Object.freeze({ dayKey, decisionBase: decisionCount, orderBase: orderCount });
  }
  return prev;
}

export function applyDailyBaseline(base: DailyBaseline | null, decisionCount: number | null, orderCount: number | null, nowMs: number): { readonly decisionCount: number | null; readonly paperOrderCount: number | null } {
  if (decisionCount == null || orderCount == null) return Object.freeze({ decisionCount, paperOrderCount: orderCount });
  const b = nextDailyBaseline(base, decisionCount, orderCount, nowMs);
  return Object.freeze({ decisionCount: decisionCount - b.decisionBase, paperOrderCount: orderCount - b.orderBase });
}

export function parseDailyBaseline(raw: string | null): DailyBaseline | null {
  try {
    const v = raw == null ? null : JSON.parse(raw);
    if (v && [v.dayKey, v.decisionBase, v.orderBase].every((n) => Number.isFinite(n) && n >= 0)) return Object.freeze({ dayKey: v.dayKey, decisionBase: v.decisionBase, orderBase: v.orderBase });
  } catch { /* fall through */ }
  return null;
}
