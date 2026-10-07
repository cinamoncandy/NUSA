import { tradingDayKey } from "../../../packages/contracts/src/risk-safety-integration";

/**
 * The one trading day (Asia/Seoul) that cloud PAPER risk and its display evidence agree on. It only delegates to the canonical
 * tradingDayKey, which builds an Intl formatter on every call; a risk evaluation asks the same fill timestamps repeatedly, so the
 * answers are memoized (bounded) instead of formatting the timezone per fill per evaluation.
 */
const MAXIMUM_CACHED_TIMESTAMPS = 50_000;
const cache = new Map<number, string>();

export function paperTradingDayKey(timestamp: number): string {
  const cached = cache.get(timestamp);
  if (cached !== undefined) return cached;
  const key = tradingDayKey(timestamp);
  if (cache.size >= MAXIMUM_CACHED_TIMESTAMPS) cache.clear();
  cache.set(timestamp, key);
  return key;
}

/** Start (00:00 Asia/Seoul) of the given trading-day key, in epoch milliseconds. */
export function paperTradingDayStartedAt(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00+09:00`);
}
