import type { WatchlistMarket } from "./watchlist";

/**
 * Selects the safest market source for Home without coupling public quotation access to Cloud/PAPER.
 * A non-null public feed is authoritative for the current public observation cycle, including an
 * empty feed; null means the public request has not produced a result yet, so a validated Cloud
 * snapshot may remain visible as a fallback.
 */
export function selectHomeMarketData(
  publicMarkets: readonly WatchlistMarket[] | null,
  snapshotMarkets: readonly WatchlistMarket[],
): readonly WatchlistMarket[] {
  return publicMarkets ?? snapshotMarkets;
}

export type HomeMarketSource = "PUBLIC" | "SNAPSHOT" | "NONE";

export interface HomeMarketFeed {
  readonly rows: readonly WatchlistMarket[];
  readonly source: HomeMarketSource;
  /** True unless a fresh public observation cycle produced the rows. */
  readonly isStale: boolean;
}

export interface HomeMarketFlags {
  readonly isStale: boolean;
  readonly connectionState: string;
}

/**
 * Selects the safest market source for Home and reports its provenance, so
 * stale fallbacks can never render identically to fresh observations.
 * A Cloud snapshot fallback is always stale by construction.
 */
export function selectHomeMarketFeed(
  publicMarkets: readonly WatchlistMarket[] | null,
  snapshotMarkets: readonly WatchlistMarket[],
  flags: HomeMarketFlags,
): HomeMarketFeed {
  if (publicMarkets != null) {
    return Object.freeze({ rows: publicMarkets, source: "PUBLIC" as const, isStale: flags.isStale });
  }
  if (snapshotMarkets.length > 0) {
    return Object.freeze({ rows: snapshotMarkets, source: "SNAPSHOT" as const, isStale: true });
  }
  return Object.freeze({ rows: [], source: "NONE" as const, isStale: true });
}

export type HomeMarketAvailability = "LOADING" | "EMPTY" | "READY";

/** Distinguishes "still loading" (null) from "loaded but empty" for empty states. */
export function homeMarketAvailability(feed: readonly WatchlistMarket[] | null): HomeMarketAvailability {
  if (feed === null) return "LOADING";
  return feed.length === 0 ? "EMPTY" : "READY";
}

/** Renderable staleness label, or null when the feed is fresh. */
export function homeMarketStaleLabel(feed: HomeMarketFeed): string | null {
  if (!feed.isStale) return null;
  return feed.source === "SNAPSHOT" ? "STALE · snapshot" : "STALE";
}
