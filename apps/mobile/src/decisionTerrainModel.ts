/**
 * Decision terrain (owner-chosen main motion graphic, 2026-10-20): today's 09:00 KST window as hour rows, each row 12 five-minute
 * heights from the server's display-only decision trace. Presentation only. Buckets the runtime did not observe (before its `since`,
 * or still in the future) are null, never zero.
 */
export const TERRAIN_BUCKET_MS = 300_000;
export const TERRAIN_BUCKETS = 288;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PER_ROW = 12;

export interface DecisionTrace { readonly since: number; readonly decisions: readonly number[]; readonly orders: readonly number[] }
export interface TerrainRow {
  /** KST hour of day this row covers (the window starts at 09). */
  readonly hour: number;
  /** Epoch ms at which this hour starts. */
  readonly startAt: number;
  /** 12 heights in 0..1, null where unobserved. */
  readonly values: readonly (number | null)[];
  /** 0..1 positions inside the row where a PAPER order was placed. */
  readonly orders: readonly number[];
  /** Observed decisions and PAPER orders in this hour (unobserved buckets are not counted), or null without a trace. */
  readonly decisionCount: number | null;
  readonly orderCount: number | null;
}
export interface DecisionTerrainModel {
  /** Oldest first; the last row is the current hour. */
  readonly rows: readonly TerrainRow[];
  /** How far the current hour has run, 0..1. */
  readonly progress: number;
  /** Decisions so far in the current hour, or null without a trace. */
  readonly thisHour: number | null;
  /** Where the loss limit stopped buying today, as a row index and a 0..1 position, when it is inside the visible rows. */
  readonly stop: { readonly row: number; readonly at: number } | null;
  readonly hasTrace: boolean;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function parseDecisionTrace(value: unknown): DecisionTrace | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const ok = (a: unknown): a is number[] => Array.isArray(a) && a.length === TERRAIN_BUCKETS && a.every(isCount);
  if (!isCount(v.since) || v.bucketMs !== TERRAIN_BUCKET_MS || !ok(v.decisions) || !ok(v.orders)) return null;
  return { since: v.since, decisions: v.decisions, orders: v.orders };
}

export function buildDecisionTerrain(input: { readonly trace: unknown; readonly now: number; readonly limitReachedAt?: unknown; readonly maxRows?: number }): DecisionTerrainModel {
  const { now } = input;
  const maxRows = Math.max(2, Math.min(24, input.maxRows ?? 14));
  const windowStart = Math.floor(now / DAY_MS) * DAY_MS;
  const nowHour = Math.min(23, Math.floor((now - windowStart) / HOUR_MS));
  const first = Math.max(0, nowHour - maxRows + 1);
  const progress = Math.min(1, Math.max(0, ((now - windowStart) % HOUR_MS) / HOUR_MS));
  const trace = parseDecisionTrace(input.trace);
  // A trace from another window (stale snapshot across 09:00) describes a different day: draw nothing rather than misplace it.
  const usable = trace != null && trace.since >= windowStart && trace.since <= now ? trace : null;
  const observed = (bucket: number): boolean => {
    if (usable == null) return false;
    const start = windowStart + bucket * TERRAIN_BUCKET_MS;
    return start + TERRAIN_BUCKET_MS > usable.since && start <= now;
  };
  let scale = 1;
  if (usable != null) for (let b = first * PER_ROW; b <= nowHour * PER_ROW + PER_ROW - 1; b += 1) if (observed(b)) scale = Math.max(scale, usable.decisions[b]!);
  const rows: TerrainRow[] = [];
  for (let r = first; r <= nowHour; r += 1) {
    const values: (number | null)[] = [], orders: number[] = [];
    let decisionCount = 0, orderCount = 0;
    for (let j = 0; j < PER_ROW; j += 1) {
      const b = r * PER_ROW + j;
      if (!observed(b)) { values.push(null); continue; }
      values.push(Math.sqrt(usable!.decisions[b]! / scale));
      decisionCount += usable!.decisions[b]!; orderCount += usable!.orders[b]!;
      if (usable!.orders[b]! > 0) orders.push((j + 0.5) / PER_ROW);
    }
    rows.push(Object.freeze({ hour: (9 + r) % 24, startAt: windowStart + r * HOUR_MS, values: Object.freeze(values), orders: Object.freeze(orders), decisionCount: usable == null ? null : decisionCount, orderCount: usable == null ? null : orderCount }));
  }
  let thisHour: number | null = null;
  if (usable != null) { thisHour = 0; for (let j = 0; j < PER_ROW; j += 1) if (observed(nowHour * PER_ROW + j)) thisHour += usable.decisions[nowHour * PER_ROW + j]!; }
  let stop: DecisionTerrainModel["stop"] = null;
  const at = input.limitReachedAt;
  if (typeof at === "number" && Number.isFinite(at) && at >= windowStart && at <= now) {
    const hour = Math.floor((at - windowStart) / HOUR_MS);
    if (hour >= first) stop = Object.freeze({ row: hour - first, at: ((at - windowStart) % HOUR_MS) / HOUR_MS });
    else stop = Object.freeze({ row: 0, at: 0 });
  }
  return Object.freeze({ rows: Object.freeze(rows), progress, thisHour, stop, hasTrace: usable != null });
}
