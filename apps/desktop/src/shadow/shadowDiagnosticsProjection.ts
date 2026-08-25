import type { ShadowPilotSession } from "./shadowPilotRuntime";
import type { MarketConnectionDiagnostics, MarketFreshness } from "../exchange/marketConnectionSupervisor";
import type { ShadowEvidenceBusDiagnostics } from "./shadowEvidenceBus";
import type { ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import type { ShadowLongRunningDiagnostics } from "./shadowLongRunningDiagnostics";
import type { ShadowLifecycleStatus, ShadowMarketDataStatus, ShadowOperationalDiagnostics, ShadowSignalOutcome } from "./shadowOperationalTypes";

export interface ShadowDiagnosticsProjectionInput {
  readonly lifecycle: ShadowLifecycleStatus;
  readonly session: ShadowPilotSession | undefined;
  readonly closedCandleCount: number;
  readonly requiredWarmupCandles: number;
  readonly warmupComplete: boolean;
  readonly symbol: string;
  readonly strategyId: string;
  readonly marketDataStatus: ShadowMarketDataStatus;
  readonly lastClosedCandleTime: number | undefined;
  readonly lastSignalTime: number | undefined;
  readonly sessionStartedAt: number | undefined;
  readonly now: number;
  readonly maxSessionDurationMs: number | undefined;
  readonly outOfOrderCandleCount: number;
  readonly duplicateCandleCount: number;
  readonly staleCandleCount: number;
  readonly lastSignal: ShadowSignalOutcome | undefined;
  readonly marketRecoveryResumeAllowed: boolean;
  readonly marketRecoveryResumeSuggested: boolean;
  readonly marketConnection: MarketConnectionDiagnostics | null;
  readonly marketFreshness: MarketFreshness;
  readonly strategyVersion: string;
  readonly strategyFingerprint: string;
  readonly completionHistory: readonly ShadowCompletionEvidence[];
  readonly longRunning: ShadowLongRunningDiagnostics;
  readonly blockers: readonly string[];
}

/**
 * Pure projection of ShadowOperationalRuntime's internal state into its public diagnostics
 * shape, extracted verbatim (ADR-0015 item 4). The runtime still owns reflecting an
 * asynchronous evidence halt onto its own lifecycle before calling this (reflectEvidenceHalt())
 * -- that is a state *mutation*, not a projection, so it deliberately stays in the class.
 */
export function buildShadowOperationalDiagnostics(input: ShadowDiagnosticsProjectionInput): ShadowOperationalDiagnostics {
  return Object.freeze({
    state: input.lifecycle,
    sessionId: input.session?.sessionId ?? null,
    symbol: input.symbol,
    strategyId: input.strategyId,
    marketDataStatus: input.marketDataStatus,
    closedCandleCount: input.closedCandleCount,
    requiredWarmupCandles: input.requiredWarmupCandles,
    warmupComplete: input.warmupComplete,
    lastClosedCandleTime: input.lastClosedCandleTime ?? null,
    lastSignalTime: input.lastSignalTime ?? null,
    startedAt: input.sessionStartedAt ?? null,
    elapsedMs: input.sessionStartedAt === undefined ? 0 : Math.max(0, input.now - input.sessionStartedAt),
    maxSessionDurationMs: input.maxSessionDurationMs ?? null,
    outOfOrderCandleCount: input.outOfOrderCandleCount,
    duplicateCandleCount: input.duplicateCandleCount,
    staleCandleCount: input.staleCandleCount,
    lastSignal: input.lastSignal ?? null,
    signalCount: input.session?.counters.signalCount ?? 0,
    hypotheticalOrderCount: input.session?.counters.hypotheticalOrderCount ?? 0,
    hypotheticalFillCount: input.session?.counters.hypotheticalFillCount ?? 0,
    actualBrokerCallCount: 0,
    executionGateCallCount: 0,
    actualOrderCount: input.session?.counters.actualOrderCount ?? 0,
    actualFillCount: input.session?.counters.actualFillCount ?? 0,
    cashMutationCount: input.session?.counters.cashMutationCount ?? 0,
    positionMutationCount: input.session?.counters.positionMutationCount ?? 0,
    blockers: Object.freeze([...input.blockers]),
    automaticResumeAllowed: false,
    marketRecoveryResumeAllowed: input.marketRecoveryResumeAllowed,
    marketRecoveryResumeSuggested: input.marketRecoveryResumeSuggested,
    marketConnection: input.marketConnection,
    marketFreshness: input.marketFreshness,
    productionMutationAllowed: false,
    strategyVersion: input.strategyVersion,
    inputType: "CLOSED_CANDLE",
    interval: "1m",
    sourceType: "UPBIT_PUBLIC_CANDLE",
    strategyFingerprint: input.strategyFingerprint,
    completionHistory: Object.freeze([...input.completionHistory]),
    longRunning: input.longRunning
  });
}

export interface ShadowLongRunningSnapshotInput {
  readonly now: number;
  readonly session: ShadowPilotSession | undefined;
  readonly lifecycle: ShadowLifecycleStatus;
  readonly sessionStartedAt: number | undefined;
  readonly evidence: ShadowEvidenceBusDiagnostics | undefined;
  readonly sourceTimestamp: number | null;
  readonly marketListenerCount: number;
  readonly marketSubscriptionCount: number;
  readonly hostIntervalCount: number;
  readonly hostTimeoutCount: number;
}

/** Pure projection backing ShadowLongRunningDiagnosticsSampler's readSource callback, extracted verbatim (ADR-0015 item 4). */
export function buildShadowLongRunningSourceSnapshot(input: ShadowLongRunningSnapshotInput) {
  return {
    timestamp: input.now,
    sessionId: input.session?.sessionId ?? null,
    sessionState: input.lifecycle,
    observationStartedAt: input.sessionStartedAt ?? null,
    elapsedTime: input.sessionStartedAt === undefined ? 0 : Math.max(0, input.now - input.sessionStartedAt),
    signalCount: input.session?.counters.signalCount ?? 0,
    evidenceCount: input.evidence?.delivered ?? 0,
    marketListenerCount: Math.max(0, input.marketListenerCount),
    marketSubscriptionCount: Math.max(0, input.marketSubscriptionCount),
    hostIntervalCount: Math.max(0, input.hostIntervalCount),
    hostTimeoutCount: Math.max(0, input.hostTimeoutCount),
    lastEventAt: input.sourceTimestamp,
    lastEvidenceAt: input.evidence && input.evidence.delivered > 0 ? input.sourceTimestamp : null,
    actualOrderCount: input.session?.counters.actualOrderCount ?? 0,
    actualFillCount: input.session?.counters.actualFillCount ?? 0,
    cashMutationCount: input.session?.counters.cashMutationCount ?? 0,
    positionMutationCount: input.session?.counters.positionMutationCount ?? 0,
    brokerCallCount: 0,
    privateApiCallCount: 0
  };
}
