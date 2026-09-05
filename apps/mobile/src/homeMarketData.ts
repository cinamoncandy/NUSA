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
