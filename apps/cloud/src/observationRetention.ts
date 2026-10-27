import type { IntelligenceObservation } from "./marketIntelligenceFusion";

/**
 * In-memory window of accepted public-market observations the PAPER decision strategies read.
 *
 * It used to be one window of 50 shared by every market. The baseline strategy (SMA 5/20) needs 20 observations
 * of the SAME market, so with five markets each kept about 10 and the strategy sat at "10/20" forever and could
 * never act. The cap is now per market: a quiet market never starves a busy one, and no market is starved by the
 * number of markets configured. Total size is bounded by (markets x cap) with at most 5 markets.
 */
export const OBSERVATION_RETENTION_PER_MARKET = 40;

export function retainObservation(
  store: Map<string, IntelligenceObservation>,
  observation: IntelligenceObservation,
  perMarketCap: number = OBSERVATION_RETENTION_PER_MARKET,
): void {
  if (!Number.isSafeInteger(perMarketCap) || perMarketCap < 1) throw new Error("per-market observation cap is invalid");
  store.set(observation.id, observation);
  let count = 0;
  for (const item of store.values()) if (item.market === observation.market) count += 1;
  if (count <= perMarketCap) return;
  // Oldest first: a Map iterates in insertion order and a re-set of an existing id keeps its place.
  for (const [key, item] of store) {
    if (item.market !== observation.market) continue;
    store.delete(key);
    count -= 1;
    if (count <= perMarketCap) break;
  }
}
