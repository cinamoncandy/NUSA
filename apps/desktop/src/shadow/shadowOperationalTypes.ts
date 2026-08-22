import type { MarketConnectionDiagnostics, MarketFreshness } from "../exchange/marketConnectionSupervisor";
import type { ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import type { ShadowLongRunningDiagnostics } from "./shadowLongRunningDiagnostics";

/**
 * Types shared between ShadowOperationalRuntime and its extracted pure-computation modules
 * (shadowReadinessBlockers.ts, shadowDiagnosticsProjection.ts), split out so those modules
 * import from here rather than from shadowOperationalRuntime.ts itself -- importing back from
 * the class file they are extracted from would create a type-only dependency cycle.
 * shadowOperationalRuntime.ts re-exports these for every existing external caller.
 */

export type ShadowLifecycleStatus = "IDLE" | "PRECHECK" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "HALTED" | "FAILED" | "INVALIDATED";
export type ShadowMarketDataStatus = "CONNECTING" | "WARMING_UP" | "HEALTHY" | "STALE" | "RECONNECTING" | "GAP_DETECTED" | "OUT_OF_ORDER" | "CLOCK_DRIFT" | "DISCONNECTED";

/**
 * The last signal's journey through the pipeline, recorded so the UI can explain a specific
 * blocked signal rather than approximating one from session-level blockers. Every field is
 * copied from the values the dispatch actually used -- none of it is re-derived afterwards.
 */
export interface ShadowSignalOutcome {
  readonly at: number;
  readonly signalType: "BUY" | "SELL";
  /** The strategy's own words for why it wanted to act, e.g. "short-SMA crossed above long-SMA". */
  readonly strategyReason: string;
  readonly riskDecision: "ALLOW" | "REJECT" | "HALT";
  readonly reasonCodes: readonly string[];
  readonly quantity: number;
  readonly price: number;
  /** True when the pilot recorded a hypothetical fill. Actual fills remain impossible here. */
  readonly hypotheticalFill: boolean;
}

export interface ShadowOperationalDiagnostics {
  readonly state: ShadowLifecycleStatus;
  readonly sessionId: string | null;
  readonly symbol: string;
  readonly strategyId: string;
  readonly marketDataStatus: ShadowMarketDataStatus;
  readonly closedCandleCount: number;
  readonly requiredWarmupCandles: number;
  readonly warmupComplete: boolean;
  readonly lastClosedCandleTime: number | null;
  readonly lastSignalTime: number | null;
  /** When the current session started, or null outside a session (WO-0034-A4). */
  readonly startedAt: number | null;
  /** How long the current session has been running. 0 outside a session (WO-0034-A4). */
  readonly elapsedMs: number;
  /** The configured hard ceiling, or null when no ceiling was configured (WO-0034-A4). */
  readonly maxSessionDurationMs: number | null;
  /** Closed candles the runtime refused because they arrived out of order (WO-0034-A4). */
  readonly outOfOrderCandleCount: number;
  /** Closed candles the runtime refused as already-seen (WO-0034-A4). */
  readonly duplicateCandleCount: number;
  /** Closed candles the runtime refused as older than the staleness tolerance (WO-0034-A4). */
  readonly staleCandleCount: number;
  readonly signalCount: number;
  readonly hypotheticalOrderCount: number;
  readonly hypotheticalFillCount: number;
  readonly actualBrokerCallCount: 0;
  readonly executionGateCallCount: 0;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly blockers: readonly string[];
  readonly lastSignal: ShadowSignalOutcome | null;
  /**
   * Unchanged and still literally false: no session that stopped for a SAFETY reason ever
   * resumes itself. A4L's market-recovery resume is a separate, narrower claim carried by
   * `marketRecoveryResumeAllowed` below, so neither field has to be read as covering the
   * other.
   */
  readonly automaticResumeAllowed: false;
  /**
   * WO-0034-A4L. True only when this runtime is configured to return a session to RUNNING
   * after a pause caused SOLELY by the public feed dropping, and only once the full precheck
   * passes again. An owner pause, a stale feed, a clock drift, a gap, or any halt is outside
   * it entirely.
   */
  readonly marketRecoveryResumeAllowed: boolean;
  /**
   * A UI hint, not a guarantee: the session is paused only on market-connection blockers and
   * the feed is back. `resume()` still re-runs the full precheck and may still refuse -- most
   * often because the warm-up restarted when the feed did.
   */
  readonly marketRecoveryResumeSuggested: boolean;
  /** Read-only connection state, retry counters, and episode log (WO-0034-A4L). */
  readonly marketConnection: MarketConnectionDiagnostics | null;
  readonly marketFreshness: MarketFreshness;
  readonly productionMutationAllowed: false;
  readonly strategyVersion: string;
  readonly inputType: "CLOSED_CANDLE";
  readonly interval: "1m";
  readonly sourceType: "UPBIT_PUBLIC_CANDLE";
  readonly strategyFingerprint: string;
  /** Completed sessions remain visible as history; this is never used as current-session state. */
  readonly completionHistory: readonly ShadowCompletionEvidence[];
  readonly longRunning: ShadowLongRunningDiagnostics;
}

/** What the running system currently knows about safety preconditions. Read fresh on every precheck/resume. */
export interface ShadowSafetyState {
  readonly deploymentIntegrity: boolean;
  readonly reconciliation: boolean;
  readonly killSwitch: boolean;
  readonly openP0: boolean;
  readonly automaticTrading: boolean;
  readonly currentModeIsCanaryOrExtended: boolean;
}

export type ShadowEvidenceRecoveryState = "NONE" | "RECOVERY_REQUIRED";
