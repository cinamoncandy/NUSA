import type { LiveReadinessSourceObservation } from "./liveReadinessSourceProvider";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { LiveRuntimeSafetyState } from "./liveReadinessGate";

/**
 * The automatic Cloud PAPER loop already has a canonical operational heartbeat.  This adapter
 * projects that read-only state into the existing LiveReadinessSourceReaders contract; it does
 * not create another PAPER runtime or evaluate LIVE policy.
 */
export interface PaperAutoLearningRuntimeEvidence {
  readonly configured: boolean;
  readonly publicMarketDataEnabled: boolean;
  readonly connectionState: string;
  readonly state: MobileDashboardApiInput | undefined;
  readonly heartbeat: Readonly<{
    readonly lastMarketEventAt: number | null;
    readonly lastError: string | null;
  }>;
}

export const PAPER_AUTO_LEARNING_MAX_OBSERVATION_AGE_MS = 30_000;

const unknown = (): LiveReadinessSourceObservation<"STABLE" | "UNSTABLE" | "UNKNOWN"> => Object.freeze({
  value: "UNKNOWN",
  freshness: "UNKNOWN",
});

const observedAt = (timestamp: number): string | undefined => {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return undefined;
  const value = new Date(timestamp);
  return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
};

/**
 * Converts objective production PAPER runtime facts into a conservative readiness observation.
 * Missing setup, missing market observations, stale observations, unhealthy dashboard state,
 * connection loss, or a runtime error can never become STABLE.
 */
export function readPaperAutoLearningReadiness(
  evidence: PaperAutoLearningRuntimeEvidence,
  nowMs: number,
): LiveReadinessSourceObservation<"STABLE" | "UNSTABLE" | "UNKNOWN"> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !evidence.configured || !evidence.publicMarketDataEnabled) return unknown();
  const lastMarketEventAt = evidence.heartbeat.lastMarketEventAt;
  if (lastMarketEventAt == null) return unknown();
  const sourceObservedAt = observedAt(lastMarketEventAt);
  if (sourceObservedAt === undefined || lastMarketEventAt > nowMs) return unknown();

  const freshness = nowMs - lastMarketEventAt <= PAPER_AUTO_LEARNING_MAX_OBSERVATION_AGE_MS ? "FRESH" as const : "STALE" as const;
  const observation = (value: "STABLE" | "UNSTABLE") => Object.freeze({ value, freshness, observedAt: sourceObservedAt });
  const state = evidence.state;
  if (
    evidence.connectionState !== "CONNECTED" ||
    state == null ||
    state.mode !== "PAPER" ||
    state.killSwitchActive ||
    state.overallHealth !== "HEALTHY" ||
    evidence.heartbeat.lastError != null ||
    freshness === "STALE"
  ) return observation("UNSTABLE");
  return observation("STABLE");
}

export interface CloudRuntimeSafetyEvidence {
  readonly state: MobileDashboardApiInput | undefined;
  readonly connectionState: string;
}

const unknownRuntimeSafety = (): LiveRuntimeSafetyState => Object.freeze({
  killSwitchActive: false,
  staleMarketData: false,
  reconciliationMismatch: false,
  exchangeError: false,
  abnormalBalanceDrift: false,
  riskBudgetBreached: false,
  strategyInvalidated: false,
  latencyOrSlippageBreached: false,
});

/**
 * Projects only the safety facts the Cloud dashboard actually owns.  The remaining runtime
 * safety dimensions are intentionally left with UNKNOWN freshness; a partial dashboard view
 * must never be mistaken for a complete LIVE safety evaluation.
 */
export function readCloudRuntimeSafety(evidence: CloudRuntimeSafetyEvidence): LiveReadinessSourceObservation<LiveRuntimeSafetyState> {
  const state = evidence.state;
  if (state == null) return Object.freeze({ value: unknownRuntimeSafety(), freshness: "UNKNOWN" });
  const observedAt = new Date(state.now);
  if (!Number.isFinite(observedAt.getTime())) return Object.freeze({ value: unknownRuntimeSafety(), freshness: "UNKNOWN" });
  return Object.freeze({
    value: Object.freeze({
      ...unknownRuntimeSafety(),
      killSwitchActive: state.killSwitchActive,
      staleMarketData: evidence.connectionState !== "CONNECTED" || state.intelligence.staleSources.length > 0,
    }),
    // Reconciliation, balance drift, risk-budget, strategy, exchange and latency evidence are
    // not represented by MobileDashboardApiInput, so this source remains incomplete by design.
    freshness: "UNKNOWN",
    observedAt: observedAt.toISOString(),
  });
}
