import type { StoredResearchCandle } from "../../../packages/storage/src/researchCandleStore";

/**
 * One-time history fill for the research candle store from Upbit's PUBLIC 1-minute candle endpoint (no
 * credentials, GET only). The research experiments need train + validation + holdout days of closed candles;
 * collecting them only from the live ticker takes that many real days.
 *
 * Safety properties (research evidence only: LIVE NONE, no orders, no capital/risk/execution change):
 * - It only ever writes candles OLDER than anything already stored, evaluated at the moment of each append, so
 *   it can never conflict with, replace or race the live collector (stored candles are immutable).
 * - Only fully closed minutes are accepted; every candle is validated; invalid ones are dropped and counted.
 * - Requests are sequential, spaced, time-bounded and page-bounded; a rate limit or any request error stops the
 *   attempt and reports it. It never retries in a tight loop.
 */
export const UPBIT_MINUTE_CANDLES_URL = "https://api.upbit.com/v1/candles/minutes/1";
export const BACKFILL_PAGE_SIZE = 200;
const MINUTE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const UTC_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export class BackfillRateLimitedError extends Error {
  public constructor() { super("upbit candle request was rate limited"); this.name = "BackfillRateLimitedError"; }
}

export interface ParsedCandles {
  readonly candles: readonly StoredResearchCandle[];
  readonly rejected: number;
  /** Start of the oldest candle in the page (ms), for the next page cursor; undefined when the page had none. */
  readonly oldestStartMs: number | undefined;
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Parses one Upbit page (newest first). Never throws: malformed items are counted and skipped. */
export function parseUpbitMinuteCandles(raw: unknown, market: string): ParsedCandles {
  if (!Array.isArray(raw)) return Object.freeze({ candles: Object.freeze([]), rejected: 1, oldestStartMs: undefined });
  const candles: StoredResearchCandle[] = [];
  let rejected = 0;
  let oldest: number | undefined;
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const match = typeof o.candle_date_time_utc === "string" ? UTC_LOCAL.exec(o.candle_date_time_utc) : null;
    const startMs = match == null ? NaN : Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
    const open = o.opening_price;
    const high = o.high_price;
    const low = o.low_price;
    const close = o.trade_price;
    if (o.market !== market || !Number.isSafeInteger(startMs) || startMs <= 0 || startMs % MINUTE_MS !== 0
      || !positive(open) || !positive(high) || !positive(low) || !positive(close)
      || high < Math.max(open, close, low) || low > Math.min(open, close, high)) { rejected += 1; continue; }
    oldest = oldest === undefined ? startMs : Math.min(oldest, startMs);
    candles.push(Object.freeze({ closeTimeMs: startMs + MINUTE_MS, open, high, low, close }));
  }
  candles.sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  return Object.freeze({ candles: Object.freeze(candles), rejected, oldestStartMs: oldest });
}

export interface BackfillStore {
  earliestCloseTime(market: string, intervalMs: number): number | undefined;
  append(market: string, intervalMs: number, candles: readonly StoredResearchCandle[]): number;
}

export interface BackfillResult {
  readonly market: string;
  readonly status: "COMPLETE" | "INCOMPLETE" | "RATE_LIMITED" | "ERROR";
  readonly recorded: number;
  readonly rejected: number;
  readonly pages: number;
  readonly earliestCloseMs?: number;
  readonly errorCode?: string;
}

export interface BackfillInput {
  readonly market: string;
  /** How far back from now the history should reach. */
  readonly targetSpanMs: number;
  readonly nowMs: number;
  readonly store: BackfillStore;
  /** Returns the raw JSON page ending before `toIso` (UTC, no zone suffix); the newest page when undefined. */
  readonly fetchPage: (market: string, toIso: string | undefined) => Promise<unknown>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pageDelayMs?: number;
  readonly maxPages?: number;
}

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19);

export async function backfillMarket(input: BackfillInput): Promise<BackfillResult> {
  const { market, store } = input;
  if (!MARKET.test(market)) throw new Error("backfill market is invalid");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) throw new Error("backfill clock is invalid");
  if (!Number.isSafeInteger(input.targetSpanMs) || input.targetSpanMs < MINUTE_MS) throw new Error("backfill span is invalid");
  const anchor = Math.floor(input.nowMs / MINUTE_MS) * MINUTE_MS; // the last minute that has fully closed
  const goal = anchor - input.targetSpanMs;
  const delay = input.pageDelayMs ?? 150;
  const maxPages = input.maxPages ?? Math.ceil(input.targetSpanMs / (BACKFILL_PAGE_SIZE * MINUTE_MS)) + 10;
  let recorded = 0;
  let rejected = 0;
  let pages = 0;
  let cursor: string | undefined;
  const result = (status: BackfillResult["status"], errorCode?: string): BackfillResult => {
    const earliest = store.earliestCloseTime(market, MINUTE_MS);
    return Object.freeze({ market, status, recorded, rejected, pages, ...(earliest === undefined ? {} : { earliestCloseMs: earliest }), ...(errorCode === undefined ? {} : { errorCode }) });
  };
  const reached = (): boolean => { const earliest = store.earliestCloseTime(market, MINUTE_MS); return earliest !== undefined && earliest <= goal; };
  if (reached()) return result("COMPLETE");
  while (pages < maxPages) {
    let raw: unknown;
    try {
      raw = await input.fetchPage(market, cursor);
    } catch (error) {
      if (error instanceof BackfillRateLimitedError) return result("RATE_LIMITED", "RATE_LIMITED");
      return result("ERROR", typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "REQUEST_FAILED");
    }
    pages += 1;
    const parsed = parseUpbitMinuteCandles(raw, market);
    rejected += parsed.rejected;
    if (parsed.oldestStartMs === undefined) return result(parsed.rejected > 0 ? "ERROR" : "COMPLETE", parsed.rejected > 0 ? "MALFORMED_PAGE" : undefined);
    try {
      // Evaluated now, in the same synchronous step as the append: only strictly older, fully closed candles.
      const ceiling = store.earliestCloseTime(market, MINUTE_MS) ?? Number.POSITIVE_INFINITY;
      const fresh = parsed.candles.filter((c) => c.closeTimeMs < ceiling && c.closeTimeMs <= anchor);
      if (fresh.length > 0) recorded += store.append(market, MINUTE_MS, fresh);
    } catch (error) {
      return result("ERROR", typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "STORE_FAILED");
    }
    if (reached()) return result("COMPLETE");
    if (parsed.oldestStartMs <= goal) return result("COMPLETE"); // the exchange has nothing older inside the span
    cursor = iso(parsed.oldestStartMs);
    await input.sleep(delay);
  }
  return result("INCOMPLETE");
}

/** Public, credential-free page fetch with a hard timeout and no redirects. */
export function createUpbitMinuteCandleFetcher(fetchImpl: typeof fetch = fetch): BackfillInput["fetchPage"] {
  return async (market, toIso) => {
    if (!MARKET.test(market)) throw new Error("backfill market is invalid");
    const url = new URL(UPBIT_MINUTE_CANDLES_URL);
    url.searchParams.set("market", market);
    url.searchParams.set("count", String(BACKFILL_PAGE_SIZE));
    if (toIso !== undefined) url.searchParams.set("to", `${toIso}Z`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url.toString(), { method: "GET", redirect: "error", signal: controller.signal });
      if (response.status === 429) throw new BackfillRateLimitedError();
      if (!response.ok) throw Object.assign(new Error(`upstream status ${response.status}`), { code: `UPSTREAM_${response.status}` });
      return await response.json() as unknown;
    } finally {
      clearTimeout(timer);
    }
  };
}
