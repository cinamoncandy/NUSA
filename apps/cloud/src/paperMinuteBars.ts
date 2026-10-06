/**
 * Completed 1-minute closing prices for the PAPER candidate strategy, built from the persisted public-ticker store.
 *
 * Why: the strategy's periods (e.g. SMA 5/20) were being applied to every ticker event, i.e. a horizon of seconds.
 * An offline replay on 20,000 real KRW-XRP ticks (2026-10-06) gave 0.5% wins and -51% net after the 0.05% fee per
 * side, with a 12 s median hold. The owner chose to evaluate on the same minute horizon research uses.
 *
 * Only completed minutes are used (no partial current bar, no look-ahead). A minute with no observation has no bar
 * (no forward fill). The close of a minute is its last observed price, stamped with that observation's real time.
 */
export interface MinuteBarObservation { readonly observedAt: number; readonly price: number }

export const MINUTE_MS = 60_000;
export const PAPER_MINUTE_BAR_LOOKBACK = 60;

export function completedMinuteCloses(observations: readonly MinuteBarObservation[], now: number, maxBars = PAPER_MINUTE_BAR_LOOKBACK): readonly (readonly [number, number])[] {
  const currentMinute = Math.floor(now / MINUTE_MS);
  const lastByMinute = new Map<number, MinuteBarObservation>();
  for (const item of observations) {
    if (!Number.isSafeInteger(item.observedAt) || !Number.isFinite(item.price) || item.price <= 0 || item.observedAt > now) continue;
    const minute = Math.floor(item.observedAt / MINUTE_MS);
    if (minute >= currentMinute) continue;
    const previous = lastByMinute.get(minute);
    if (previous == null || item.observedAt >= previous.observedAt) lastByMinute.set(minute, item);
  }
  const bars = [...lastByMinute.entries()].sort(([a], [b]) => a - b).map(([, item]) => Object.freeze([item.observedAt, item.price] as const));
  return Object.freeze(bars.slice(-maxBars));
}

/**
 * Per-market cache: the store is read at most once per market per minute, so the per-tick decision path never
 * scans SQLite. A read failure yields no bars, so the strategy waits (INSUFFICIENT) instead of falling back to ticks.
 */
export class PaperMinuteBarSource {
  private readonly cache = new Map<string, { minute: number; bars: readonly (readonly [number, number])[] }>();

  public constructor(
    private readonly readWindow: (market: string, startAt: number, endAt: number) => readonly MinuteBarObservation[],
    private readonly maxBars = PAPER_MINUTE_BAR_LOOKBACK,
  ) {}

  public read(market: string, now: number): readonly (readonly [number, number])[] {
    const key = market.trim().toUpperCase();
    const minute = Math.floor(now / MINUTE_MS);
    const cached = this.cache.get(key);
    if (cached != null && cached.minute === minute) return cached.bars;
    let bars: readonly (readonly [number, number])[] = Object.freeze([]);
    try {
      const start = (minute - this.maxBars - 1) * MINUTE_MS;
      bars = completedMinuteCloses(this.readWindow(key, Math.max(0, start), now), now, this.maxBars);
    } catch { /* fail closed: no bars, the strategy waits */ }
    this.cache.set(key, { minute, bars });
    return bars;
  }
}
