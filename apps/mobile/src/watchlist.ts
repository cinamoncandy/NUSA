export type WatchlistSort = "MARKET" | "PRICE" | "CHANGE" | "VOLUME";

export interface WatchlistMarket {
  readonly market: string;
  readonly price: number;
  readonly changeRate: number | null;
  readonly volume: number | null;
  readonly observedAt: string;
  readonly source: "UPBIT_PUBLIC_TICKER";
}

export interface WatchlistStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
import { VersionedJsonStore } from "./mobilePersistence";

export interface WatchlistViewModel {
  readonly state: "LOADING" | "EMPTY" | "READY" | "ERROR";
  readonly error: string | null;
  readonly query: string;
  readonly sort: WatchlistSort;
  readonly watchlist: readonly string[];
  readonly activeMarkets: readonly WatchlistMarket[];
  readonly searchResults: readonly WatchlistMarket[];
}

const WATCHLIST_KEY = "nusa:watchlist:v1";
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const marketPattern = /^[A-Z0-9]+-[A-Z0-9]+$/;

function validMarket(value: string): boolean {
  return marketPattern.test(value.trim());
}

export function normalizeWatchlist(markets: readonly string[]): readonly string[] {
  const result: string[] = [];
  for (const market of markets) {
    const normalized = market.trim().toUpperCase();
    if (!validMarket(normalized)) throw new Error("watchlist market is invalid");
    if (!result.includes(normalized)) result.push(normalized);
  }
  return freeze(result);
}

export function parseWatchlistMarkets(raw: unknown): readonly WatchlistMarket[] {
  if (!Array.isArray(raw)) throw new Error("market response is invalid");
  const markets = raw.map((value, index) => {
    if (value === null || typeof value !== "object") throw new Error(`market ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const market = typeof row.market === "string" ? row.market.trim().toUpperCase() : "";
    const changeRate = row.changeRate === null || row.changeRate === undefined ? null : row.changeRate;
    const volume = row.volume === null || row.volume === undefined ? null : row.volume;
    if (!validMarket(market) || !Number.isFinite(row.price) || (row.price as number) <= 0 || (changeRate !== null && (typeof changeRate !== "number" || !Number.isFinite(changeRate))) || (volume !== null && (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0)) || typeof row.observedAt !== "string" || row.source !== "UPBIT_PUBLIC_TICKER") throw new Error(`market ${index} is invalid`);
    return freeze({ market, price: row.price as number, changeRate: changeRate as number | null, volume: volume as number | null, observedAt: row.observedAt, source: "UPBIT_PUBLIC_TICKER" as const });
  });
  return freeze(markets);
}

export class WatchlistRepository {
  private readonly durable: VersionedJsonStore<readonly string[]>;
  public constructor(storage: WatchlistStorage, key = WATCHLIST_KEY) { this.durable = new VersionedJsonStore(storage, key, 1, (value) => { if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) throw new Error("invalid watchlist payload"); return normalizeWatchlist(value); }); }

  public async load(): Promise<readonly string[]> {
    try { return (await this.durable.load()) ?? freeze([]); } catch { throw new Error("stored watchlist is invalid"); }
  }

  public async save(markets: readonly string[]): Promise<readonly string[]> {
    const normalized = normalizeWatchlist(markets);
    await this.durable.save(normalized);
    return normalized;
  }

  public async add(market: string): Promise<readonly string[]> { return this.save([...(await this.load()), market]); }
  public async remove(market: string): Promise<readonly string[]> { return this.save((await this.load()).filter((item) => item !== market)); }
}

function compareMarkets(left: WatchlistMarket, right: WatchlistMarket, sort: WatchlistSort): number {
  if (sort === "PRICE") return right.price - left.price || left.market.localeCompare(right.market);
  if (sort === "CHANGE") return (right.changeRate ?? Number.NEGATIVE_INFINITY) - (left.changeRate ?? Number.NEGATIVE_INFINITY) || left.market.localeCompare(right.market);
  if (sort === "VOLUME") return (right.volume ?? Number.NEGATIVE_INFINITY) - (left.volume ?? Number.NEGATIVE_INFINITY) || left.market.localeCompare(right.market);
  return left.market.localeCompare(right.market);
}

/**
 * Newest valid observation instant across a feed, for first-class freshness
 * display. Invalid timestamps are skipped, never thrown: an unparseable row
 * must not take down the list. Returns null when nothing parseable exists.
 */
export function freshestObservedAtMs(markets: readonly WatchlistMarket[]): number | null {
  let latest: number | null = null;
  for (const market of markets) {
    const at = Date.parse(market.observedAt);
    if (!Number.isFinite(at) || at <= 0) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * Short Korean relative age for a feed instant ("방금", "12초 전", ...).
 * Pure function of two instants so unit tests never depend on wall-clock.
 * Returns null for unverifiable input instead of inventing an age.
 */
export function formatFeedAgeMs(observedAtMs: number, nowMs: number): string | null {
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(nowMs)) return null;
  const elapsed = nowMs - observedAtMs;
  if (elapsed < 0) return null;
  if (elapsed < 10_000) return "방금";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}초 전`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  return `${Math.floor(elapsed / 3_600_000)}시간 전`;
}

export function buildWatchlistViewModel(input: { readonly rawMarkets: unknown[] | null; readonly watchlist: readonly string[] | null; readonly query: string; readonly sort: WatchlistSort }): WatchlistViewModel {
  const empty = (state: WatchlistViewModel["state"], error: string | null): WatchlistViewModel => freeze({ state, error, query: input.query, sort: input.sort, watchlist: input.watchlist ?? [], activeMarkets: [], searchResults: [] });
  const watchlist = input.watchlist;
  if (input.rawMarkets === null || watchlist === null) return empty("LOADING", null);
  let markets: readonly WatchlistMarket[];
  try { markets = parseWatchlistMarkets(input.rawMarkets); } catch (error) { return empty("ERROR", error instanceof Error ? error.message : "MARKET_DATA_INVALID"); }
  if (markets.length === 0) return empty("EMPTY", "NO_PUBLIC_MARKETS");
  const query = input.query.trim().toUpperCase();
  const searchable = markets.filter((market) => query === "" || market.market.includes(query));
  const activeMarkets = markets.filter((market) => watchlist.includes(market.market)).sort((left, right) => compareMarkets(left, right, input.sort));
  const searchResults = searchable.sort((left, right) => compareMarkets(left, right, input.sort));
  return freeze({ state: "READY", error: null, query: input.query, sort: input.sort, watchlist: freeze([...watchlist]), activeMarkets: freeze(activeMarkets), searchResults: freeze(searchResults) });
}

export const watchlistStorageKey = WATCHLIST_KEY;
