/** Daily 09:00 KST (00:00 UTC) reset for the HOME decision/order counters. Display only. */
export const DAILY_RESET_UTC_HOUR = 0;
const DAY_MS = 86_400_000;

export interface DailyBaseline {
  readonly dayKey: number;
  /** Identity of the runtime instance whose cumulative counters the baseline belongs to. */
  readonly sourceId: number;
  readonly decisionBase: number;
  readonly orderBase: number;
}

/** Index of the 09:00 KST window containing `nowMs`. */
export function resetDayKey(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

export function msUntilNextReset(nowMs: number): number {
  return (resetDayKey(nowMs) + 1) * DAY_MS - nowMs;
}

export function nextDailyBaseline(prev: DailyBaseline | null, sourceId: number, decisionCount: number, orderCount: number, nowMs: number): DailyBaseline {
  const dayKey = resetDayKey(nowMs);
  // A new window, or a server counter that went backwards (restart), starts a fresh baseline.
  if (prev == null || prev.dayKey !== dayKey || prev.sourceId !== sourceId || decisionCount < prev.decisionBase || orderCount < prev.orderBase) {
    return Object.freeze({ dayKey, sourceId, decisionBase: decisionCount, orderBase: orderCount });
  }
  return prev;
}

export function applyDailyBaseline(base: DailyBaseline | null, sourceId: number | null, decisionCount: number | null, orderCount: number | null, nowMs: number): { readonly decisionCount: number | null; readonly paperOrderCount: number | null } {
  if (decisionCount == null || orderCount == null || sourceId == null) return Object.freeze({ decisionCount: null, paperOrderCount: null });
  const b = nextDailyBaseline(base, sourceId, decisionCount, orderCount, nowMs);
  return Object.freeze({ decisionCount: decisionCount - b.decisionBase, paperOrderCount: orderCount - b.orderBase });
}

export function parseDailyBaseline(raw: string | null): DailyBaseline | null {
  try {
    const v = raw == null ? null : JSON.parse(raw);
    if (v && [v.dayKey, v.sourceId, v.decisionBase, v.orderBase].every((n) => Number.isFinite(n) && n >= 0)) return Object.freeze({ dayKey: v.dayKey, sourceId: v.sourceId, decisionBase: v.decisionBase, orderBase: v.orderBase });
  } catch { /* fall through */ }
  return null;
}

const wholeCount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/**
 * Prefer the server's own 09:00 KST window counts: they cover the whole window even when the app is opened
 * late, whereas the client baseline only counts from the app's first look at a run. Both server values must
 * be usable, otherwise the client-baseline counts are used unchanged (older servers, no PAPER boundary).
 */
export function chooseDailyCounts(
  serverDecisions: unknown,
  serverOrders: unknown,
  baselineCounts: { readonly decisionCount: number | null; readonly paperOrderCount: number | null },
): { readonly decisionCount: number | null; readonly paperOrderCount: number | null } {
  const decisions = wholeCount(serverDecisions);
  const orders = wholeCount(serverOrders);
  if (decisions == null || orders == null) return baselineCounts;
  return Object.freeze({ decisionCount: decisions, paperOrderCount: orders });
}
