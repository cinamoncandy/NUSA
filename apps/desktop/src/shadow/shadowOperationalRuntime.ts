import { randomUUID } from "node:crypto";
import type { ClosedCandle, PublicTickerSample } from "../strategy/closedCandleAdapter";
import { ShadowPilotRuntime, verifyShadowPilotEvents, type ShadowPilotEvent, type ShadowPilotSession } from "./shadowPilotRuntime";
import type { StrategyEngine, StrategySignal } from "../strategy/strategyEngine";
import type { PaperCommandRiskGate } from "../control/runtimeCommandService";
import type { UpbitMinuteCandleSource } from "../exchange/upbitMinuteCandleSource";
import type { ShadowEvidenceBus, ShadowEvidenceBusDiagnostics, ShadowEvidenceHaltReason } from "../shadow/shadowEvidenceBus";
import { buildShadowCompletionEvidence, type ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import { ShadowLongRunningDiagnosticsSampler } from "./shadowLongRunningDiagnostics";
import type { MarketConnectionDiagnostics, MarketConnectionEpisode, MarketFreshness } from "../exchange/marketConnectionSupervisor";
import { buildMarketConnectionEvidence, type MarketConnectionEvidence } from "../exchange/marketConnectionEvidence";
import { computeShadowReadinessBlockers } from "./shadowReadinessBlockers";
import { buildShadowOperationalDiagnostics, buildShadowLongRunningSourceSnapshot } from "./shadowDiagnosticsProjection";
import { ShadowMarketConnectionTracker, type ShadowMarketAction } from "./shadowMarketConnectionTracker";
import { ShadowCandleAdmissionTracker } from "./shadowCandleAdmissionTracker";

type PaperSide = "BUY" | "SELL";

/**
 * Wires the actual public Upbit ticker -> closed-candle -> production StrategyEngine ->
 * ShadowPilotRuntime path (WO-0034-A2). This module never imports PaperBroker and never
 * calls RuntimeCommandService.manualOrder: Shadow's only effect is hypothetical bookkeeping
 * inside ShadowPilotRuntime, which itself has no broker dependency.
 *
 * StrategyEngine.onTick is called from exactly one place in this codebase: here, once per
 * CLOSED candle. There is no remaining path that feeds a raw, in-progress ticker into the
 * strategy -- main.ts no longer calls strategy.onTick directly (see main.ts's handleTicker).
 */

// Canonical definitions moved to shadowOperationalTypes.ts to avoid a type-only import cycle
// with the pure-computation modules extracted from this class (ADR-0015 item 4); re-exported
// here for every existing external caller.
export type {
  ShadowLifecycleStatus,
  ShadowMarketDataStatus,
  ShadowSignalOutcome,
  ShadowOperationalDiagnostics,
  ShadowSafetyState,
  ShadowEvidenceRecoveryState
} from "./shadowOperationalTypes";
import type {
  ShadowLifecycleStatus,
  ShadowSignalOutcome,
  ShadowOperationalDiagnostics,
  ShadowSafetyState,
  ShadowEvidenceRecoveryState
} from "./shadowOperationalTypes";

export interface ShadowOperationalDependencies {
  readonly symbol: string;
  readonly strategyId: string;
  readonly strategyVersion?: string;
  readonly strategyFingerprint?: string;
  readonly sourceCommitSha: string;
  readonly fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>;
  readonly strategy: StrategyEngine;
  /** Read-only: current real Paper position quantity. Never mutated from this module. */
  readonly getPositionQuantity: () => number;
  /** Drives the existing, unmodified real Automatic Paper trading path (RuntimeCommandService.automaticSignal). */
  readonly onProductionSignal: (input: Readonly<{ market: string; price: number; positionQuantity: number; signal: StrategySignal }>) => void;
  readonly getSafetyState: () => ShadowSafetyState;
  /** The SAME risk gate instance RuntimeCommandService uses, so Shadow's decision is the real one, never a fabricated ALLOW. */
  readonly riskGate: PaperCommandRiskGate;
  /**
   * Shadow's hypothetical order sizing reuses the real configured Paper order quantity.
   * Shadow tracks no hypothetical position, so this is used for both BUY and SELL alike;
   * no hypothetical cash/position/PnL accounting is modeled in this phase.
   */
  readonly getHypotheticalOrderQuantity: () => number;
  readonly now?: () => number;
  /** Ticker timestamps further from wall-clock than this are CLOCK_DRIFT. Default 60s. */
  readonly clockDriftToleranceMs?: number;
  /**
   * Hard ceiling on how long one session may run (WO-0034-A4). Once elapsed time passes it
   * the runtime stops the session itself and seals the archive as COMPLETED -- the ceiling
   * is reached, not violated, so this is a normal end and not a fault.
   *
   * Left unset there is no ceiling, which is the pre-A4 behaviour.
   */
  readonly maxSessionDurationMs?: number;
  /**
   * A closed candle whose close time is older than this, relative to wall clock, is stale
   * and is not dispatched (WO-0034-A4). Unset means no staleness check, the pre-A4
   * behaviour: the market-data health gate remains the only staleness signal.
   */
  readonly maxCandleAgeMs?: number;
  /**
   * Builds the evidence bus for a newly started session. Called once per session so each one
   * gets a fresh bus -- a halted bus is never reused, and a previous session's queue can
   * never leak into a new one.
   */
  readonly createEvidenceBus: (metadata: Readonly<{ sessionId: string; createdAt: number; onHalt: (reason: ShadowEvidenceHaltReason, detail: string) => void }>) => ShadowEvidenceBus;
  /**
   * Reports evidence archives left open by a previous process. Any result at all forces
   * RECOVERY_REQUIRED and blocks start: an unsealed archive means the last session's record
   * is of unknown completeness, and continuing would append a second session's events beside
   * it with no way to tell later where one ended.
   */
  readonly findIncompleteEvidence: () => readonly string[];
  /** Read-only topology facts used by the long-running sampler. */
  readonly getMarketListenerCount?: () => number;
  readonly getMarketSubscriptionCount?: () => number;
  /**
   * Timers the host process owns (WO-0034-A4K). The runtime cannot see the host's handles,
   * so it asks rather than guessing -- an unsupplied count is reported as 0 and the caller
   * that did not supply it is the one making that claim.
   */
  readonly getHostIntervalCount?: () => number;
  readonly getHostTimeoutCount?: () => number;
  readonly readRendererMemoryUsage?: () => number | null;
  readonly longRunningDiagnosticsIntervalMs?: number;
  /**
   * WO-0034-A4L, opt-in and deliberately narrow. When true, a session PAUSED with nothing but
   * market-DISCONNECT blockers returns to RUNNING once the feed is measurably back AND the
   * full precheck passes again. It is left false by default so every caller that has not
   * asked for it keeps the pre-A4L behaviour exactly.
   *
   * It never applies to an owner pause, a STALE feed, a clock drift, a candle gap, an
   * out-of-order stream, or any HALTED/FAILED session. Those are conditions the runtime
   * cannot conclude have been resolved just because a socket opened.
   */
  readonly autoResumeOnMarketRecovery?: boolean;
  /** Age past which the feed is judged stale. Defaults to the shared reconnect policy's. */
  readonly marketFreshnessToleranceMs?: number;
}

/**
 * The ONLY pause reasons a market recovery may clear by itself (WO-0034-A4L).
 *
 * Every entry means "the public feed is not delivering right now", and a feed that is
 * measurably delivering again is direct evidence that the condition is gone. The list is a
 * whitelist rather than a "not obviously dangerous" filter, so a blocker added later is
 * excluded by default instead of being swept in by a pattern nobody re-examined.
 *
 * MARKET_DATA_STALE is deliberately absent. A connected feed that went quiet can start
 * delivering again without whatever silenced it being resolved, and an existing safety
 * decision in this runtime already says healthy market data alone never resumes a session.
 * Clock drift, candle gaps, out-of-order streams and owner pauses are absent for the same
 * reason: a socket opening is not evidence that any of them was fixed.
 */
const MARKET_RECOVERABLE_PAUSE_BLOCKERS = new Set([
  "MARKET_DATA_DISCONNECTED",
  "MARKET_DATA_RECONNECTING",
  "MARKET_DATA_RECONNECTED_REQUIRES_WARMUP",
  "MARKET_DATA_WARMING_UP",
  "MARKET_DATA_UNHEALTHY:CONNECTING",
  "MARKET_DATA_UNHEALTHY:RECONNECTING",
  "MARKET_DATA_UNHEALTHY:DISCONNECTED"
]);

/** The reason a session ends because the feed never came back within the retry policy. */
export const MARKET_RECONNECT_TIMEOUT = "MARKET_RECONNECT_TIMEOUT";

/**
 * Episode outcome -> the connection-state vocabulary the pilot event carries.
 *
 * ABANDONED becomes DISCONNECTED rather than FAILED: the retry policy was never spent, the
 * client was stopped while it was still trying, and recording that as a policy failure would
 * blame the network for an owner's action.
 */
const MARKET_EPISODE_EVENT_STATE = Object.freeze({
  RECOVERED: "RECOVERED",
  FAILED: "FAILED",
  ABANDONED: "DISCONNECTED",
  IN_PROGRESS: "RECONNECTING"
} as const);

export class ShadowOperationalRuntime {
  private lifecycle: ShadowLifecycleStatus = "IDLE";
  private readonly marketData: ShadowMarketConnectionTracker;
  private readonly candleAdmission: ShadowCandleAdmissionTracker;
  private pilot?: ShadowPilotRuntime;
  private blockers: readonly string[] = [];
  private lastClosedCandleTime?: number;
  private lastSignalTime?: number;
  private lastSignal?: ShadowSignalOutcome;
  private sessionSequence = 0;
  private readonly clockDriftToleranceMs: number;
  private evidenceBus?: ShadowEvidenceBus;
  /** Highest pilot sequence handed to the bus; the runtime half of exactly-once. */
  private publishedSequence = 0;
  private evidenceFinalization: Promise<void> = Promise.resolve();
  private readonly completionHistory: ShadowCompletionEvidence[] = [];
  private evidenceRecovery: ShadowEvidenceRecoveryState = "NONE";
  private sessionStartedAt?: number;
  private readonly longRunningDiagnostics: ShadowLongRunningDiagnosticsSampler;

  constructor(private readonly deps: ShadowOperationalDependencies) {
    this.clockDriftToleranceMs = deps.clockDriftToleranceMs ?? 60_000;
    this.marketData = new ShadowMarketConnectionTracker(deps.symbol, deps.now?.() ?? Date.now());
    this.candleAdmission = new ShadowCandleAdmissionTracker(deps.maxCandleAgeMs, () => this.now());
    this.longRunningDiagnostics = new ShadowLongRunningDiagnosticsSampler({
      readSource: () => this.longRunningSourceSnapshot(),
      intervalMs: deps.longRunningDiagnosticsIntervalMs ?? 0,
      now: () => this.now(),
      readRendererMemory: deps.readRendererMemoryUsage
    });
  }

  /** Applies the lifecycle actions ShadowMarketConnectionTracker's state transitions return, in order (ADR-0015 item 4). */
  private applyMarketActions(actions: readonly ShadowMarketAction[]): void {
    for (const action of actions) {
      if (action.kind === "AUTO_PAUSE") this.autoPauseIfRunning(action.reasonCodes);
      else this.haltActiveSession(action.reasonCodes);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Bounded, read-only public-market history for the localhost mobile monitor. */
  recentClosedCandles(limit = 200): readonly ClosedCandle[] {
    return this.marketData.recentClosedCandles(limit);
  }

  private autoPauseIfRunning(reasonCodes: readonly string[]): void {
    if (this.lifecycle !== "RUNNING") return;
    this.lifecycle = "PAUSED";
    this.blockers = [...reasonCodes];
  }

  /**
   * Hands every pilot event not yet published to the bus, in order. Driven off the pilot's
   * own append-only log rather than off each call site, so a code path that appends an event
   * without remembering to publish it cannot silently omit it from the durable record.
   */
  private publishPendingEvents(): void {
    if (!this.evidenceBus || !this.pilot) return;
    for (const event of this.pilot.eventsAfter(this.publishedSequence)) {
      if (!this.evidenceBus.publish(event)) {
        const diagnostics = this.evidenceBus.diagnostics();
        this.onEvidenceHalt(diagnostics.haltReason ?? "SINK_WRITE_FAILED", diagnostics.haltDetail ?? "evidence publish refused");
        return;
      }
      this.publishedSequence = event.sequence;
    }
  }

  /** Called by the bus itself when a sink write or finalize fails. */
  private onEvidenceHalt(reason: ShadowEvidenceHaltReason, detail: string): void {
    this.lifecycle = "HALTED";
    this.blockers = [`EVIDENCE_${reason}`, detail];
    this.longRunningDiagnostics.stop();
    if (this.pilot && this.pilot.snapshot().status === "RUNNING") {
      try { this.pilot.stop(this.now()); } catch { /* the archive is already halted; seal what exists */ }
    }
    this.finalizeEvidence(`EVIDENCE_${reason}`, "ABORTED");
  }

  /** Seals the archive asynchronously without changing the synchronous lifecycle API. */
  private finalizeEvidence(reason: string, status: "COMPLETED" | "ABORTED"): void {
    const bus = this.evidenceBus;
    if (!bus) return;
    const completion = buildShadowCompletionEvidence({ diagnostics: this.diagnostics(), completionReason: reason, completedAt: this.now() });
    if (completion && !this.completionHistory.some((entry) => entry.sessionId === completion.sessionId)) this.completionHistory.push(completion);
    const marketConnection = this.buildMarketConnectionEvidence();
    this.evidenceFinalization = this.evidenceFinalization
      .then(() => bus.finalize(reason, status, completion ?? undefined, marketConnection))
      .catch((error) => this.onEvidenceHalt("SINK_FINALIZE_FAILED", error instanceof Error ? error.message : String(error)));
  }

  private buildMarketConnectionEvidence(): MarketConnectionEvidence | undefined {
    const sessionId = this.pilot?.snapshot().sessionId;
    if (sessionId === undefined) return undefined;
    return buildMarketConnectionEvidence({ sessionId, episodes: this.marketConnectionEpisodes(), generatedAt: this.now() });
  }

  async awaitEvidenceFinalized(): Promise<void> {
    await this.evidenceBus?.flush();
    await this.evidenceFinalization;
  }

  evidenceDiagnostics(): ShadowEvidenceBusDiagnostics | null {
    return this.evidenceBus?.diagnostics() ?? null;
  }

  /** Read-only hash-chained evidence for the SHADOW observability projection. */
  eventLog(): readonly ShadowPilotEvent[] {
    return Object.freeze([...(this.pilot?.eventLog() ?? [])]);
  }

  evidenceRecoveryState(): ShadowEvidenceRecoveryState {
    return this.evidenceRecovery;
  }

  private reflectEvidenceHalt(): void {
    const bus = this.evidenceBus;
    if (!bus) return;
    const status = bus.diagnostics();
    if (status.status !== "HALTED") return;
    if (this.lifecycle !== "RUNNING" && this.lifecycle !== "PAUSED") return;
    this.onEvidenceHalt(status.haltReason ?? "SINK_WRITE_FAILED", status.haltDetail ?? "evidence bus halted");
  }

  private haltActiveSession(reasonCodes: readonly string[]): void {
    if (this.lifecycle !== "RUNNING" && this.lifecycle !== "PAUSED") return;
    if (this.pilot && this.pilot.snapshot().status === "RUNNING") {
      try { this.pilot.stop(this.now()); } catch { /* best-effort session close only */ }
    }
    this.lifecycle = "HALTED";
    this.blockers = [...reasonCodes];
    this.longRunningDiagnostics.stop();
    this.publishPendingEvents();
    this.finalizeEvidence(reasonCodes.join(","), "ABORTED");
  }

  onWebSocketStatus(status: string): void {
    const result = this.marketData.onWebSocketStatus(status, this.now());
    this.applyMarketActions(result.actions);
  }

  onMarketConnectionState(diagnostics: MarketConnectionDiagnostics): void {
    const result = this.marketData.onMarketConnectionState(diagnostics, this.sessionStartedAt);
    let appended = false;
    for (const episode of result.newEpisodes) {
      if (this.pilot?.snapshot().status !== "RUNNING") continue;
      this.pilot.recordMarketConnection(episode.recoveredAt ?? episode.disconnectedAt, Object.freeze({
        disconnectedAt: episode.disconnectedAt,
        reconnectAttemptCount: episode.reconnectAttemptCount,
        recoveredAt: episode.recoveredAt,
        totalDowntime: episode.totalDowntime,
        finalReconnectState: MARKET_EPISODE_EVENT_STATE[episode.finalReconnectState]
      }), [`MARKET_CONNECTION_${episode.finalReconnectState}`]);
      appended = true;
    }
    if (appended) this.publishPendingEvents();
    this.applyMarketActions(result.actions);
  }

  marketConnectionDiagnostics(): MarketConnectionDiagnostics | null {
    return this.marketData.marketConnectionDiagnostics();
  }

  marketConnectionEpisodes(): readonly MarketConnectionEpisode[] {
    return this.marketData.marketConnectionEpisodes();
  }

  private marketFreshness(): MarketFreshness {
    return this.marketData.marketFreshness(this.lastClosedCandleTime, this.deps.marketFreshnessToleranceMs, this.now());
  }

  private resumeSuggestedAfterMarketRecovery(): boolean {
    if (this.lifecycle !== "PAUSED" || this.blockers.length === 0) return false;
    if (!this.blockers.every((code) => MARKET_RECOVERABLE_PAUSE_BLOCKERS.has(code))) return false;
    const state = this.marketData.marketConnectionDiagnostics()?.marketConnectionState;
    return state === "CONNECTED" || state === "RECOVERED";
  }

  private tryResumeAfterMarketRecovery(): void {
    if (this.deps.autoResumeOnMarketRecovery !== true) return;
    if (!this.resumeSuggestedAfterMarketRecovery()) return;
    const blockers = this.startPrecheckBlockers();
    if (blockers.length > 0) {
      this.blockers = blockers;
      return;
    }
    this.lifecycle = "RUNNING";
    this.blockers = [];
  }

  onTicker(ticker: PublicTickerSample): void {
    const result = this.marketData.onTicker(ticker, this.now(), this.clockDriftToleranceMs);
    this.applyMarketActions(result.actions);
    if (result.adverse) return;
    for (const candle of result.emittedCandles) this.onClosedCandle(candle);
    this.tryResumeAfterMarketRecovery();
  }

  async syncOfficialCandles(source: UpbitMinuteCandleSource): Promise<void> {
    const result = await this.marketData.syncOfficialCandles(source);
    if ("error" in result) {
      this.marketData.markOfficialCandleSourceError(result.error);
      this.autoPauseIfRunning(["OFFICIAL_CANDLE_SOURCE_UNAVAILABLE"]);
      return;
    }
    for (const candle of result.candles) {
      this.marketData.rememberClosedCandle(candle);
      this.onClosedCandle(candle);
    }
    this.tryResumeAfterMarketRecovery();
  }

  private stopIfSessionDurationExceeded(): boolean {
    if (this.deps.maxSessionDurationMs === undefined || this.sessionStartedAt === undefined) return false;
    if (this.lifecycle !== "RUNNING" && this.lifecycle !== "PAUSED") return false;
    if (this.now() - this.sessionStartedAt < this.deps.maxSessionDurationMs) return false;
    if (this.pilot && this.pilot.snapshot().status === "RUNNING") this.pilot.stop(this.now());
    this.lifecycle = "COMPLETED";
    this.blockers = ["MAX_SESSION_DURATION_REACHED"];
    this.publishPendingEvents();
    this.finalizeEvidence("MAX_SESSION_DURATION_REACHED", "COMPLETED");
    return true;
  }

  private onClosedCandle(candle: ClosedCandle): void {
    this.marketData.rememberClosedCandle(candle);
    this.lastClosedCandleTime = candle.closeTime;
    const position = this.deps.getPositionQuantity();
    const signal = this.deps.strategy.onTick({ market: this.deps.symbol, price: candle.close, timestamp: candle.closeTime }, position);
    this.deps.onProductionSignal({ market: this.deps.symbol, price: candle.close, positionQuantity: position, signal });

    if (this.stopIfSessionDurationExceeded()) return;
    if (this.lifecycle !== "RUNNING") return;

    const admission = this.candleAdmission.admit(candle);
    if (admission === "OUT_OF_ORDER") {
      this.haltActiveSession(["CANDLE_SEQUENCE_REGRESSION"]);
      return;
    }
    if (admission !== "OK") return;
    this.candleAdmission.commit(candle);
    if (signal.type === "HOLD") return;
    this.dispatchShadowSignal(candle, signal);
  }

  private dispatchShadowSignal(candle: ClosedCandle, signal: StrategySignal): void {
    if (!this.pilot) return;
    const side = signal.type as PaperSide;
    const quantity = this.deps.getHypotheticalOrderQuantity();
    const signalId = `${this.deps.symbol}:${candle.closeTime}:${signal.type}`;
    const commandId = `shadow:${signalId}`;
    const clientOrderId = `paper:${commandId}`;
    const decision = this.deps.riskGate.evaluate(Object.freeze({ path: "SHADOW" as const, side, quantity, price: candle.close, strategyId: this.deps.strategyId, signalId, commandId, clientOrderId, nowMs: candle.closeTime }));
    const fillsBefore = this.pilot.snapshot().counters.hypotheticalFillCount;
    this.pilot.observe({ timestamp: candle.closeTime, signalId, commandId, side, quantity, decision: decision.status, reasonCodes: decision.reasonCodes });
    this.lastSignalTime = candle.closeTime;
    this.lastSignal = Object.freeze({
      at: candle.closeTime,
      signalType: side,
      strategyReason: signal.reason,
      riskDecision: decision.status,
      reasonCodes: Object.freeze([...decision.reasonCodes]),
      quantity,
      price: candle.close,
      hypotheticalFill: this.pilot.snapshot().counters.hypotheticalFillCount > fillsBefore
    });
    this.publishPendingEvents();
    if (this.lifecycle !== "RUNNING") return;
    const integrityErrors = verifyShadowPilotEvents(this.pilot.eventLog(), this.deps.sourceCommitSha);
    if (integrityErrors.length > 0) {
      this.lifecycle = "FAILED";
      this.blockers = integrityErrors;
      this.finalizeEvidence(integrityErrors.join(","), "ABORTED");
      return;
    }
    if (this.pilot.snapshot().status === "HALTED") {
      this.lifecycle = "HALTED";
      this.blockers = [...decision.reasonCodes];
      this.finalizeEvidence(decision.reasonCodes.join(","), "ABORTED");
    }
  }

  private computeReadinessBlockers(persistRecovery = true): readonly string[] {
    const result = computeShadowReadinessBlockers({
      safety: this.deps.getSafetyState(),
      findIncompleteEvidence: () => this.deps.findIncompleteEvidence(),
      currentEvidenceRecovery: this.evidenceRecovery,
      webSocketConnected: this.marketData.isWebSocketConnected(),
      marketDataStatus: this.marketData.status(),
      candleAdapterWarmupComplete: this.marketData.candleAdapterState().warmupComplete,
      officialWarmupComplete: this.marketData.officialWarmupComplete()
    });
    if (persistRecovery) this.evidenceRecovery = result.evidenceRecovery;
    return result.blockers;
  }

  startPrecheckBlockers(persistRecovery = true): readonly string[] {
    return Object.freeze([...this.computeReadinessBlockers(persistRecovery)]);
  }

  start(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "IDLE") throw new Error(`shadow start requires IDLE, currently ${this.lifecycle}`);
    this.lifecycle = "PRECHECK";
    const now = this.now();
    const blockers = this.startPrecheckBlockers();
    if (blockers.length > 0) {
      if (blockers.length === 1 && blockers[0] === "MARKET_DATA_WARMING_UP") {
        this.lifecycle = "IDLE";
        this.blockers = blockers;
        return this.diagnostics();
      }
      this.lifecycle = "HALTED";
      this.blockers = blockers;
      return this.diagnostics();
    }
    const sessionId = `shadow-${this.deps.sourceCommitSha.slice(0, 12)}-${now}-${++this.sessionSequence}-${randomUUID()}`;
    const pilot = new ShadowPilotRuntime({
      sessionId, createdAt: now, sourceCommitSha: this.deps.sourceCommitSha,
      symbol: this.deps.symbol, strategyId: this.deps.strategyId, fingerprints: this.deps.fingerprints
    });
    const pilotSafety = this.deps.getSafetyState();
    const pilotStatus = pilot.precheck({
      paperOnly: true,
      deploymentIntegrity: pilotSafety.deploymentIntegrity,
      reconciliation: pilotSafety.reconciliation,
      killSwitch: pilotSafety.killSwitch,
      openP0: pilotSafety.openP0,
      marketDataHealthy: this.marketData.isWebSocketConnected() && (this.marketData.status() === "HEALTHY" || this.marketData.status() === "WARMING_UP"),
      warmedUp: this.marketData.officialWarmupComplete() || this.marketData.candleAdapterState().warmupComplete,
      automaticTrading: pilotSafety.automaticTrading
    });
    this.pilot = pilot;
    if (pilotStatus !== "READY") {
      this.lifecycle = "HALTED";
      this.blockers = pilot.snapshot().blockers;
      return this.diagnostics();
    }
    try {
      this.evidenceBus = this.deps.createEvidenceBus({
        sessionId,
        createdAt: now,
        onHalt: (reason, detail) => this.onEvidenceHalt(reason, detail)
      });
    } catch (error) {
      this.lifecycle = "HALTED";
      this.blockers = ["EVIDENCE_BUS_CREATE_FAILED", error instanceof Error ? error.message : String(error)];
      return this.diagnostics();
    }
    this.publishedSequence = 0;
    this.sessionStartedAt = now;
    this.candleAdmission.reset();
    this.marketData.resetForNewSession();
    pilot.start(now);
    this.lifecycle = "RUNNING";
    this.blockers = [];
    this.longRunningDiagnostics.start(sessionId);
    this.publishPendingEvents();
    return this.diagnostics();
  }

  pause(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "RUNNING") throw new Error(`shadow pause requires RUNNING, currently ${this.lifecycle}`);
    this.lifecycle = "PAUSED";
    this.blockers = ["OWNER_REQUESTED_PAUSE"];
    return this.diagnostics();
  }

  resume(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "PAUSED") throw new Error(`shadow resume requires PAUSED, currently ${this.lifecycle}`);
    const blockers = this.startPrecheckBlockers();
    if (blockers.length > 0) {
      this.blockers = blockers;
      return this.diagnostics();
    }
    this.lifecycle = "RUNNING";
    this.blockers = [];
    return this.diagnostics();
  }

  stop(): ShadowOperationalDiagnostics {
    if (!["RUNNING", "PAUSED", "HALTED"].includes(this.lifecycle)) throw new Error(`shadow stop requires RUNNING, PAUSED, or HALTED, currently ${this.lifecycle}`);
    const pilotStatus = this.pilot?.snapshot().status;
    if (this.pilot && (pilotStatus === "RUNNING" || pilotStatus === "HALTED")) this.pilot.stop(this.now());
    const aborted = this.lifecycle === "HALTED";
    if (!aborted) this.lifecycle = "COMPLETED";
    this.blockers = aborted ? this.blockers : [];
    this.longRunningDiagnostics.stop();
    this.publishPendingEvents();
    this.finalizeEvidence(aborted ? "SESSION_HALTED" : "OWNER_STOPPED", aborted ? "ABORTED" : "COMPLETED");
    return this.diagnostics();
  }

  async prepareForNextSession(): Promise<ShadowOperationalDiagnostics> {
    if (this.lifecycle !== "COMPLETED") {
      throw new Error(`next shadow session requires COMPLETED, currently ${this.lifecycle}`);
    }
    await this.awaitEvidenceFinalized();
    this.pilot = undefined;
    this.evidenceBus = undefined;
    this.evidenceFinalization = Promise.resolve();
    this.evidenceRecovery = "NONE";
    this.longRunningDiagnostics.reset();
    this.sessionStartedAt = undefined;
    this.lastClosedCandleTime = undefined;
    this.lastSignalTime = undefined;
    this.lastSignal = undefined;
    this.publishedSequence = 0;
    this.candleAdmission.reset();
    this.marketData.resetForNextSession(this.now());
    this.lifecycle = "IDLE";
    this.blockers = [];
    return this.diagnostics();
  }

  diagnostics(): ShadowOperationalDiagnostics {
    this.reflectEvidenceHalt();
    const session: ShadowPilotSession | undefined = this.pilot?.snapshot();
    const candleState = this.marketData.candleAdapterState();
    const admissionState = this.candleAdmission.snapshot();
    const closedCandleCount = Math.max(candleState.closedCandleCount, this.marketData.officialClosedCandleCountValue());
    return buildShadowOperationalDiagnostics({
      lifecycle: this.lifecycle,
      session,
      closedCandleCount,
      requiredWarmupCandles: candleState.requiredWarmupCandles,
      warmupComplete: this.marketData.officialWarmupComplete() || candleState.warmupComplete,
      symbol: this.deps.symbol,
      strategyId: this.deps.strategyId,
      marketDataStatus: this.marketData.status(),
      lastClosedCandleTime: this.lastClosedCandleTime,
      lastSignalTime: this.lastSignalTime,
      sessionStartedAt: this.sessionStartedAt,
      now: this.now(),
      maxSessionDurationMs: this.deps.maxSessionDurationMs,
      outOfOrderCandleCount: admissionState.outOfOrderCandleCount,
      duplicateCandleCount: admissionState.duplicateCandleCount,
      staleCandleCount: admissionState.staleCandleCount,
      lastSignal: this.lastSignal,
      marketRecoveryResumeAllowed: this.deps.autoResumeOnMarketRecovery === true,
      marketRecoveryResumeSuggested: this.resumeSuggestedAfterMarketRecovery(),
      marketConnection: this.marketData.marketConnectionDiagnostics(),
      marketFreshness: this.marketFreshness(),
      strategyVersion: this.deps.strategyVersion ?? `${this.deps.strategyId}:legacy-ticker-v1`,
      strategyFingerprint: this.deps.strategyFingerprint ?? this.deps.fingerprints.strategy,
      completionHistory: this.completionHistory,
      longRunning: this.longRunningDiagnostics.diagnostics(),
      blockers: this.blockers
    });
  }

  private longRunningSourceSnapshot() {
    const session = this.pilot?.snapshot();
    const evidence = this.evidenceBus?.diagnostics();
    return buildShadowLongRunningSourceSnapshot({
      now: this.now(),
      session,
      lifecycle: this.lifecycle,
      sessionStartedAt: this.sessionStartedAt,
      evidence,
      sourceTimestamp: this.lastSignalTime ?? this.lastClosedCandleTime ?? null,
      marketListenerCount: this.deps.getMarketListenerCount?.() ?? 0,
      marketSubscriptionCount: this.deps.getMarketSubscriptionCount?.() ?? 0,
      hostIntervalCount: this.deps.getHostIntervalCount?.() ?? 0,
      hostTimeoutCount: this.deps.getHostTimeoutCount?.() ?? 0
    });
  }
}
