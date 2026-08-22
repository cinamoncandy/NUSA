import type { MarketConnectionEpisode } from "../exchange/marketConnectionSupervisor";
import type { ShadowLifecycleStatus } from "./shadowOperationalTypes";

const MARKET_RECOVERABLE_PAUSE_BLOCKERS = new Set([
  "MARKET_DATA_DISCONNECTED",
  "MARKET_DATA_RECONNECTING",
  "MARKET_DATA_RECONNECTED_REQUIRES_WARMUP",
  "MARKET_DATA_WARMING_UP",
  "MARKET_DATA_UNHEALTHY:CONNECTING",
  "MARKET_DATA_UNHEALTHY:RECONNECTING",
  "MARKET_DATA_UNHEALTHY:DISCONNECTED"
]);

const MARKET_EPISODE_EVENT_STATE = Object.freeze({
  RECOVERED: "RECOVERED",
  FAILED: "FAILED",
  ABANDONED: "DISCONNECTED",
  IN_PROGRESS: "RECONNECTING"
} as const);

export type ShadowMarketConnectionEventState = "RECOVERED" | "FAILED" | "DISCONNECTED" | "RECONNECTING";

/**
 * Returns whether a PAUSED Shadow session is eligible for a market-data-driven resume hint.
 * The whitelist is fail-closed: newly introduced blockers are not resumable until explicitly
 * classified here.
 */
export function isShadowMarketRecoveryResumeEligible(input: Readonly<{
  lifecycle: ShadowLifecycleStatus;
  blockers: readonly string[];
  marketConnectionState: string | undefined;
}>): boolean {
  if (input.lifecycle !== "PAUSED" || input.blockers.length === 0) return false;
  if (!input.blockers.every((code) => MARKET_RECOVERABLE_PAUSE_BLOCKERS.has(code))) return false;
  return input.marketConnectionState === "CONNECTED" || input.marketConnectionState === "RECOVERED";
}

/** Maps a closed connection episode to the canonical state recorded in the pilot event. */
export function shadowMarketEpisodeEventState(
  finalReconnectState: MarketConnectionEpisode["finalReconnectState"]
): ShadowMarketConnectionEventState {
  return MARKET_EPISODE_EVENT_STATE[finalReconnectState];
}
