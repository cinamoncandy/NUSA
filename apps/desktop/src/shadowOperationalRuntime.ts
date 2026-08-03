import { randomUUID } from "node:crypto";
import { createClosedCandleAdapter, type ClosedCandle, type ClosedCandleAdapter, type PublicTickerSample } from "./closedCandleAdapter";
import { ShadowPilotRuntime, verifyShadowPilotEvents, type ShadowPilotSession } from "./shadowPilotRuntime";
import type { StrategyEngine, StrategySignal } from "./strategyEngine";
import type { PaperCommandRiskGate } from "./runtimeCommandService";
import type { UpbitMinuteCandleSource } from "./upbitMinuteCandleSource";
import type { DomainEventBus, DomainEventBusDiagnostics, DomainEventHaltReason } from "./domainEventBus";
import { buildShadowCompletionEvidence, type ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import { ShadowLongRunningDiagnosticsSampler, type ShadowLongRunningDiagnostics } from "./shadowLongRunningDiagnostics";
import { DEFAULT_MARKET_RECONNECT_POLICY, evaluateMarketFreshness, type MarketConnectionDiagnostics, type MarketConnectionEpisode, type MarketFreshness } from "./marketConnectionSupervisor";
import { buildMarketConnectionEvidence, type MarketConnectionEvidence } from "./marketConnectionEvidence";

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
  readonly createEvidenceBus: (metadata: Readonly<{ sessionId: string; createdAt: number; onHalt: (reason: DomainEventHaltReason, detail: string) => void }>) => DomainEventBus;
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

export type ShadowEvidenceRecoveryState = "NONE" | "RECOVERY_REQUIRED";

const ADVERSE_CANDLE_HEALTH_CODES = new Set(["GAP_DETECTED", "OUT_OF_ORDER", "DISCONNECTED"]);

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
  private candleAdapter: ClosedCandleAdapter;
  private marketDataStatus: ShadowMarketDataStatus = "CONNECTING";
  private webSocketConnected = false;
  private pilot?: ShadowPilotRuntime;
  private blockers: readonly string[] = [];
  private lastClosedCandleTime?: number;
  private lastSignalTime?: number;
  private lastSignal?: ShadowSignalOutcome;
  private sessionSequence = 0;
  private readonly clockDriftToleranceMs: number;
  private lastOfficialCandleTime?: number;
  private officialClosedCandleCount = 0;
  private closedCandleHistory: readonly ClosedCandle[] = Object.freeze([]);
  private evidenceBus?: DomainEventBus;
  /** Highest pilot sequence handed to the bus; the runtime half of exactly-once. */
  private publishedSequence = 0;
  private evidenceFinalization: Promise<void> = Promise.resolve();
  private readonly completionHistory: ShadowCompletionEvidence[] = [];
  private evidenceRecovery: ShadowEvidenceRecoveryState = "NONE";
  private sessionStartedAt?: number;
  /** Close time of the last candle Shadow accepted; the basis of the ordering check. */
  private lastAdmittedCandleCloseTime?: number;
  private outOfOrderCandleCount = 0;
  private duplicateCandleCount = 0;
  private staleCandleCount = 0;
  /**
   * Close times of candles already dispatched this session. The adapter de-duplicates
   * *tickers*, and syncOfficialCandles de-duplicates by open time within its own source --
   * neither notices the same closed minute arriving once from each of the two sources.
   */
  private readonly dispatchedCandleCloseTimes = new Set<number>();
  private readonly longRunningDiagnostics: ShadowLongRunningDiagnosticsSampler;
  /** Latest read-only connection reading, or null if no supervisor has reported yet. */
  private marketConnection: MarketConnectionDiagnostics | null = null;
  /** Connection episodes belonging to the CURRENT session, keyed so a re-report cannot duplicate one. */
  private readonly sessionConnectionEpisodes = new Map<number, MarketConnectionEpisode>();
  private lastMarketMessageAt: number | null = null;

  constructor(private readonly deps: ShadowOperationalDependencies) {
    this.candleAdapter = createClosedCandleAdapter({ symbol: deps.symbol, requiredWarmupCandles: 20 });
    this.clockDriftToleranceMs = deps.clockDriftToleranceMs ?? 60_000;
    this.longRunningDiagnostics = new ShadowLongRunningDiagnosticsSampler({
      readSource: () => this.longRunningSourceSnapshot(),
      intervalMs: deps.longRunningDiagnosticsIntervalMs ?? 0,
      now: () => this.now(),
      readRendererMemory: deps.readRendererMemoryUsage
    });
    // The adapter defaults to "connected"; the real stream has not connected yet at
    // construction time, so correct that immediately rather than reporting a false HEALTHY.
    this.candleAdapter.markDisconnected(deps.now?.() ?? Date.now());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Bounded, read-only public-market history for the localhost mobile monitor. */
  recentClosedCandles(limit = 200): readonly ClosedCandle[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze([]);
    return Object.freeze(this.closedCandleHistory.slice(-Math.min(200, limit)));
  }

  private rememberClosedCandle(candle: ClosedCandle): void {
    if (candle.source !== "UPBIT_PUBLIC_CANDLE") return;
    if (this.closedCandleHistory.some((item) => item.openTime === candle.openTime)) return;
    this.closedCandleHistory = Object.freeze([...this.closedCandleHistory, candle].sort((left, right) => left.openTime - right.openTime).slice(-200));
  }

  private setMarketDataStatus(status: ShadowMarketDataStatus): void {
    this.marketDataStatus = status;
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
        // The bus refused: overflow or an already-halted bus. Either way the durable record
        // is now incomplete, so the session must not keep producing events.
        const diagnostics = this.evidenceBus.diagnostics();
        this.onEvidenceHalt(diagnostics.haltReason ?? "SINK_WRITE_FAILED", diagnostics.haltDetail ?? "evidence publish refused");
        return;
      }
      this.publishedSequence = event.sequence;
    }
  }

  /** Called by the bus itself when a sink write or finalize fails. */
  private onEvidenceHalt(reason: DomainEventHaltReason, detail: string): void {
    this.lifecycle = "HALTED";
    this.blockers = [`EVIDENCE_${reason}`, detail];
    this.longRunningDiagnostics.stop();
    if (this.pilot && this.pilot.snapshot().status === "RUNNING") {
      try { this.pilot.stop(this.now()); } catch { /* the archive is already halted; seal what exists */ }
    }
    this.finalizeEvidence(`EVIDENCE_${reason}`, "ABORTED");
  }

  /**
   * Seals the archive. Kept off the synchronous lifecycle methods because the IPC contract
   * returns diagnostics immediately; callers that need the sealed result await
   * awaitEvidenceFinalized().
   */
  private finalizeEvidence(reason: string, status: "COMPLETED" | "ABORTED"): void {
    const bus = this.evidenceBus;
    if (!bus) return;
    const completion = buildShadowCompletionEvidence({ diagnostics: this.diagnostics(), completionReason: reason, completedAt: this.now() });
    if (completion && !this.completionHistory.some((entry) => entry.sessionId === completion.sessionId)) this.completionHistory.push(completion);
    // Written for EVERY sealed session, including one that never dropped: "the feed held for
    // the whole observation" is a finding, and an archive that only records outages cannot
    // state it. Such a session seals with finalReconnectState NEVER_DISCONNECTED.
    const marketConnection = this.buildMarketConnectionEvidence();
    this.evidenceFinalization = this.evidenceFinalization
      .then(() => bus.finalize(reason, status, completion ?? undefined, marketConnection))
      .catch((error) => this.onEvidenceHalt("SINK_FINALIZE_FAILED", error instanceof Error ? error.message : String(error)));
  }

  private buildMarketConnectionEvidence(): MarketConnectionEvidence | undefined {
    const sessionId = this.pilot?.snapshot().sessionId;
    if (sessionId === undefined) return undefined;
    return buildMarketConnectionEvidence({
      sessionId,
      episodes: this.marketConnectionEpisodes(),
      generatedAt: this.now()
    });
  }

  /** Resolves once any in-flight evidence write and finalize has settled. */
  async awaitEvidenceFinalized(): Promise<void> {
    await this.evidenceBus?.flush();
    await this.evidenceFinalization;
  }

  evidenceDiagnostics(): DomainEventBusDiagnostics | null {
    return this.evidenceBus?.diagnostics() ?? null;
  }

  evidenceRecoveryState(): ShadowEvidenceRecoveryState {
    return this.evidenceRecovery;
  }

  /**
   * A sink write can fail after publish() has already returned, so the bus halts
   * asynchronously. Reflecting that on every diagnostics read is what stops a session from
   * continuing to report RUNNING while its durable record is already broken.
   */
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

  /** Real Upbit WebSocket connection-status callback, forwarded from main.ts's handleMarketStatus. */
  onWebSocketStatus(status: string): void {
    const now = this.now();
    if (status === "connected") {
      const wasConnected = this.webSocketConnected;
      this.webSocketConnected = true;
      if (!wasConnected) this.candleAdapter.markReconnected(now);
      if (!wasConnected) {
        this.lastOfficialCandleTime = undefined;
        this.officialClosedCandleCount = 0;
        this.autoPauseIfRunning(["MARKET_DATA_RECONNECTED_REQUIRES_WARMUP"]);
      }
      this.setMarketDataStatus(this.candleAdapter.inspectState().warmupComplete ? "HEALTHY" : "WARMING_UP");
      return;
    }
    if (status === "reconnect-exhausted") {
      this.webSocketConnected = false;
      this.candleAdapter.markDisconnected(now);
      this.candleAdapter.dropOpenCandle();
      this.setMarketDataStatus("DISCONNECTED");
      this.haltActiveSession(["MARKET_DATA_DISCONNECTED_EXHAUSTED"]);
      return;
    }
    if (status.startsWith("reconnecting")) {
      this.webSocketConnected = false;
      this.candleAdapter.markDisconnected(now);
      // The minute being assembled when the feed dropped is discarded rather than resumed:
      // ticks from either side of an outage are not one minute of trading (WO-0034-A4L).
      this.candleAdapter.dropOpenCandle();
      this.setMarketDataStatus("RECONNECTING");
      this.autoPauseIfRunning(["MARKET_DATA_RECONNECTING"]);
      return;
    }
    if (status === "connecting") {
      this.setMarketDataStatus(this.webSocketConnected ? "RECONNECTING" : "CONNECTING");
      return;
    }
    if (status.startsWith("stale")) {
      this.setMarketDataStatus("STALE");
      this.autoPauseIfRunning(["MARKET_DATA_STALE"]);
      return;
    }
    if (status.startsWith("error") || status.startsWith("decode-error")) {
      this.autoPauseIfRunning(["MARKET_DATA_DEGRADED"]);
    }
  }

  /**
   * Structured public-feed connection state (WO-0034-A4L), forwarded from the transport.
   *
   * This is the state-model counterpart to `onWebSocketStatus`, which stays exactly as it
   * was. The transport emits this FIRST, so the specific reason a session ends
   * (MARKET_RECONNECT_TIMEOUT) is recorded before the generic status string that follows it
   * can seal the same session under a vaguer one.
   *
   * It opens nothing, retries nothing and owns no timer -- the transport owns the single
   * reconnect timer, and this runtime only reads what that supervisor measured.
   */
  onMarketConnectionState(diagnostics: MarketConnectionDiagnostics): void {
    this.marketConnection = diagnostics;
    if (diagnostics.lastMarketMessageAt !== null) this.lastMarketMessageAt = diagnostics.lastMarketMessageAt;
    this.recordConnectionEpisodes(diagnostics.episodes);
    switch (diagnostics.marketConnectionState) {
      case "FAILED": {
        this.setMarketDataStatus("DISCONNECTED");
        const reason = diagnostics.reconnectFailureReason;
        this.haltActiveSession(reason === null ? [MARKET_RECONNECT_TIMEOUT] : [MARKET_RECONNECT_TIMEOUT, reason]);
        return;
      }
      case "DISCONNECTED":
      case "RECONNECTING": {
        // `reconnectStartedAt` is null until a disconnection episode opens, which is how a
        // first connection attempt is told apart from a reconnection. Reporting the initial
        // dial-up as RECONNECTING would show a recovery from a connection that never existed.
        const inEpisode = diagnostics.reconnectStartedAt !== null;
        this.setMarketDataStatus(inEpisode ? "RECONNECTING" : "CONNECTING");
        if (inEpisode) this.autoPauseIfRunning(["MARKET_DATA_RECONNECTING"]);
        return;
      }
      case "STALE":
        this.setMarketDataStatus("STALE");
        this.autoPauseIfRunning(["MARKET_DATA_STALE"]);
        return;
      default:
        // CONNECTED and RECOVERED do NOT resume anything here. An open socket is not a
        // delivering feed; resumption is attempted from the data path below, once real
        // market data has actually arrived and the warm-up it reset has been rebuilt.
        return;
    }
  }

  /** Read-only. Null until a connection supervisor has reported (WO-0034-A4L). */
  marketConnectionDiagnostics(): MarketConnectionDiagnostics | null {
    return this.marketConnection;
  }

  /** Connection episodes recorded for the current session, in order. */
  marketConnectionEpisodes(): readonly MarketConnectionEpisode[] {
    return Object.freeze([...this.sessionConnectionEpisodes.values()].sort((left, right) => left.episodeId - right.episodeId));
  }

  private recordConnectionEpisodes(episodes: readonly MarketConnectionEpisode[]): void {
    if (this.sessionStartedAt === undefined) return;
    let appended = false;
    for (const episode of episodes) {
      // An episode already open when the session began cannot exist: the start precheck
      // blocks on MARKET_DATA_DISCONNECTED, so a session can only begin with the feed up.
      if (episode.disconnectedAt < this.sessionStartedAt) continue;
      if (this.sessionConnectionEpisodes.has(episode.episodeId)) continue;
      this.sessionConnectionEpisodes.set(episode.episodeId, episode);
      // Each closed outage is ALSO written into the pilot's hash chain, so a reader of the
      // archive can see the transitions inside the tamper-evident record and not only in
      // the summary file. Both are derived from this same episode, so they cannot disagree.
      // The summary file is still written unconditionally: it is the only one of the two
      // that can state "this session never dropped".
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
  }

  private marketFreshness(): MarketFreshness {
    return evaluateMarketFreshness({
      now: this.now(),
      lastMessageAt: this.lastMarketMessageAt,
      latestCandleCloseTime: this.lastClosedCandleTime ?? null,
      toleranceMs: this.deps.marketFreshnessToleranceMs ?? DEFAULT_MARKET_RECONNECT_POLICY.staleAfterMs
    });
  }

  /**
   * Whether a resume looks available. A hint for the UI and nothing more: `resume()` re-runs
   * the whole precheck and may still refuse.
   */
  private resumeSuggestedAfterMarketRecovery(): boolean {
    if (this.lifecycle !== "PAUSED" || this.blockers.length === 0) return false;
    if (!this.blockers.every((code) => MARKET_RECOVERABLE_PAUSE_BLOCKERS.has(code))) return false;
    const state = this.marketConnection?.marketConnectionState;
    return state === "CONNECTED" || state === "RECOVERED";
  }

  /**
   * Returns a session paused solely by a feed drop to RUNNING, keeping the SAME sessionId,
   * pilot, and evidence bus -- a reconnection is not a new observation.
   *
   * Called from the data path rather than from the connection callback on purpose: the
   * question is not "did a socket open" but "is this feed delivering usable data again",
   * and only an accepted market message answers that. The full precheck still runs, so
   * every safety gate is re-evaluated and any non-market problem keeps the session paused.
   */
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

  /** Real accepted public ticker, forwarded from main.ts's handleTicker. */
  onTicker(ticker: PublicTickerSample): void {
    const now = this.now();
    this.lastMarketMessageAt = now;
    const drifted = Math.abs(now - ticker.trade_timestamp) > this.clockDriftToleranceMs;
    if (drifted) {
      this.setMarketDataStatus("CLOCK_DRIFT");
      this.autoPauseIfRunning(["MARKET_DATA_CLOCK_DRIFT"]);
    }
    const result = this.candleAdapter.ingestTicker(ticker);
    let adverse = drifted;
    for (const event of result.healthEvents) {
      if (event.code === "GAP_DETECTED") { this.setMarketDataStatus("GAP_DETECTED"); this.autoPauseIfRunning(["MARKET_DATA_GAP_DETECTED"]); }
      else if (event.code === "OUT_OF_ORDER") { this.setMarketDataStatus("OUT_OF_ORDER"); this.autoPauseIfRunning(["MARKET_DATA_OUT_OF_ORDER"]); }
      else if (event.code === "DISCONNECTED") { this.setMarketDataStatus("DISCONNECTED"); this.autoPauseIfRunning(["MARKET_DATA_DISCONNECTED"]); }
      if (ADVERSE_CANDLE_HEALTH_CODES.has(event.code)) adverse = true;
    }
    if (!adverse) this.setMarketDataStatus(this.candleAdapter.inspectState().warmupComplete ? "HEALTHY" : "WARMING_UP");
    // A gap, out-of-order tick, or disconnect this round means no closed candle emitted this
    // round should drive the strategy -- "gap detected 후 strategy execution 금지".
    if (adverse) return;
    for (const candle of result.emittedCandles) this.onClosedCandle(candle);
    // Deliberately last. A resume takes effect from the NEXT candle, never the one being
    // handled: that candle's warm-up contribution is what made the resume possible, and
    // dispatching it in the same pass would let one arrival both satisfy the gate and clear it.
    this.tryResumeAfterMarketRecovery();
  }

  /** Official closed-candle path. The legacy ticker adapter remains diagnostic only. */
  async syncOfficialCandles(source: UpbitMinuteCandleSource): Promise<void> {
    try {
      for (const candle of await source.loadClosedCandles(200)) {
        if (this.lastOfficialCandleTime !== undefined && candle.openTime <= this.lastOfficialCandleTime) continue;
        this.lastOfficialCandleTime = candle.openTime;
        this.officialClosedCandleCount += 1;
        this.onClosedCandle({ symbol: candle.symbol, interval: candle.interval, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, volumeAvailable: true, tradeCount: 0, closed: true, sequence: candle.openTime, source: "UPBIT_PUBLIC_CANDLE" });
      }
      this.tryResumeAfterMarketRecovery();
    } catch (error) {
      this.setMarketDataStatus(error instanceof Error && error.message.includes("missing interval") ? "GAP_DETECTED" : "STALE");
      this.autoPauseIfRunning(["OFFICIAL_CANDLE_SOURCE_UNAVAILABLE"]);
    }
  }

  /**
   * Decides whether a closed candle may drive a Shadow dispatch (WO-0034-A4).
   *
   * Returns a reason code when the candle is refused. Refusal is counted and the candle is
   * dropped -- it is never "fixed up" into an acceptable one, because a candle the runtime
   * had to repair is not evidence of what the market did.
   *
   * Deliberately does NOT gate the production signal: the real Automatic Paper path has
   * behaved one way since A2, and quietly changing which candles reach it would be a
   * production behaviour change smuggled in under an observation-safety change.
   */
  private admitClosedCandle(candle: ClosedCandle): "OK" | "NOT_CLOSED" | "DUPLICATE" | "OUT_OF_ORDER" | "STALE" {
    if (candle.closed !== true) return "NOT_CLOSED";
    if (this.dispatchedCandleCloseTimes.has(candle.closeTime)) return "DUPLICATE";
    if (this.lastAdmittedCandleCloseTime !== undefined && candle.closeTime < this.lastAdmittedCandleCloseTime) return "OUT_OF_ORDER";
    if (this.deps.maxCandleAgeMs !== undefined && this.now() - candle.closeTime > this.deps.maxCandleAgeMs) return "STALE";
    return "OK";
  }

  /**
   * Ends the session once the configured ceiling is reached (WO-0034-A4). Returns true when
   * the session was stopped, so the caller knows not to keep dispatching.
   *
   * This is a normal completion, not a halt: reaching a planned limit is the observation
   * working as designed, and sealing it as ABORTED would make an ordinary end look like a
   * fault in the evidence record.
   */
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
    this.rememberClosedCandle(candle);
    this.lastClosedCandleTime = candle.closeTime;
    const position = this.deps.getPositionQuantity();
    const signal = this.deps.strategy.onTick({ market: this.deps.symbol, price: candle.close, timestamp: candle.closeTime }, position);
    // Same production signal drives real Automatic Paper trading, unconditionally, exactly
    // as it did when triggered per-ticker -- only the trigger cadence changed. The A4
    // admission gate below deliberately sits AFTER this call: it governs what Shadow
    // observes, and moving it earlier would change which candles reach the real Automatic
    // Paper path, which is a production behaviour change, not an observation-safety one.
    this.deps.onProductionSignal({ market: this.deps.symbol, price: candle.close, positionQuantity: position, signal });

    // The ceiling is checked per candle rather than on a timer: a timer would end the session
    // between candles, at a moment no evidence event corresponds to.
    if (this.stopIfSessionDurationExceeded()) return;
    if (this.lifecycle !== "RUNNING") return;

    const admission = this.admitClosedCandle(candle);
    if (admission === "DUPLICATE") this.duplicateCandleCount += 1;
    else if (admission === "OUT_OF_ORDER") this.outOfOrderCandleCount += 1;
    else if (admission === "STALE") this.staleCandleCount += 1;
    // Out-of-order means the stream's ordering guarantee is already broken, so every later
    // candle's position in the sequence is in doubt -- the session cannot honestly continue.
    // A duplicate or a stale candle is a single bad input: count it, drop it, keep observing.
    if (admission === "OUT_OF_ORDER") {
      this.haltActiveSession(["CANDLE_SEQUENCE_REGRESSION"]);
      return;
    }
    if (admission !== "OK") return;
    this.lastAdmittedCandleCloseTime = candle.closeTime;
    this.dispatchedCandleCloseTimes.add(candle.closeTime);
    if (signal.type === "HOLD") return;
    this.dispatchShadowSignal(candle, signal);
  }

  private dispatchShadowSignal(candle: ClosedCandle, signal: StrategySignal): void {
    if (!this.pilot) return;
    const side = signal.type as PaperSide;
    const quantity = this.deps.getHypotheticalOrderQuantity();
    const decision = this.deps.riskGate.evaluate(Object.freeze({ path: "SHADOW" as const, side, quantity, price: candle.close }));
    const signalId = `${this.deps.symbol}:${candle.closeTime}:${signal.type}`;
    const commandId = randomUUID();
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
      // Read from the pilot's own counter rather than assuming ALLOW implies a fill: a
      // duplicate signal is ALLOW-shaped at the gate but records no fill.
      hypotheticalFill: this.pilot.snapshot().counters.hypotheticalFillCount > fillsBefore
    });
    // Record what happened before publishing: a publish failure halts the runtime, and the
    // Why panel still has to be able to explain the signal that was being handled when it did.
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
    const safety = this.deps.getSafetyState();
    // An archive left open by a previous process means the last session's record is of
    // unknown completeness. Starting beside it would interleave two sessions' events with
    // no way to tell later where one ended, so recovery is required before anything runs.
    let incomplete: readonly string[] = [];
    let evidenceRecovery = this.evidenceRecovery;
    try {
      incomplete = this.deps.findIncompleteEvidence();
      if (!Array.isArray(incomplete)) throw new Error("incomplete evidence scan returned an invalid result");
    } catch {
      // An unreadable evidence root is uncertainty about the previous session, not proof that
      // no session exists. Fail closed with the same recovery gate as a markerless archive.
      evidenceRecovery = "RECOVERY_REQUIRED";
    }
    if (incomplete.length > 0) evidenceRecovery = "RECOVERY_REQUIRED";
    if (persistRecovery) this.evidenceRecovery = evidenceRecovery;
    const candleState = this.candleAdapter.inspectState();
    const blockers: string[] = [];
    if (!this.webSocketConnected) blockers.push("MARKET_DATA_DISCONNECTED");
    // WARMING_UP is reported once, via the warmupComplete check below -- counting it again
    // here would turn a pure "not warmed up yet" condition into two blockers and defeat the
    // intentional softer handling of that specific, expected, retryable condition.
    else if (this.marketDataStatus !== "HEALTHY" && this.marketDataStatus !== "WARMING_UP") blockers.push(`MARKET_DATA_UNHEALTHY:${this.marketDataStatus}`);
    if (!this.officialWarmupComplete() && !candleState.warmupComplete) blockers.push("MARKET_DATA_WARMING_UP");
    if (safety.killSwitch) blockers.push("KILL_SWITCH_ACTIVE");
    if (safety.openP0) blockers.push("OPEN_P0_ALERT");
    if (!safety.deploymentIntegrity) blockers.push("DEPLOYMENT_INTEGRITY_FAILED");
    if (!safety.reconciliation) blockers.push("RECONCILIATION_REQUIRED");
    if (safety.automaticTrading) blockers.push("AUTOMATIC_TRADING_ON");
    if (safety.currentModeIsCanaryOrExtended) blockers.push("CANARY_OR_EXTENDED_MODE_ACTIVE");
    if (evidenceRecovery === "RECOVERY_REQUIRED") blockers.push("EVIDENCE_RECOVERY_REQUIRED");
    return blockers;
  }

  /**
   * Read-only owner precheck shared by diagnostics and start(). It deliberately does not
   * create a session, an evidence bus, or any market/broker mutation.
   */
  startPrecheckBlockers(persistRecovery = true): readonly string[] {
    return Object.freeze([...this.computeReadinessBlockers(persistRecovery)]);
  }

  /** Owner-explicit only. Never called automatically by this class. */
  start(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "IDLE") throw new Error(`shadow start requires IDLE, currently ${this.lifecycle}`);
    this.lifecycle = "PRECHECK";
    const now = this.now();
    const blockers = this.startPrecheckBlockers();
    if (blockers.length > 0) {
      if (blockers.length === 1 && blockers[0] === "MARKET_DATA_WARMING_UP") {
        // Not a hard failure: a normal not-ready-yet condition. Stay retryable at IDLE
        // rather than burning a HALTED session on nothing but an elapsed-time condition.
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
    // ShadowPilotRuntime's own precheck is kept as a second confirmation of the conditions
    // computeReadinessBlockers() checked above. It is only a confirmation if it is given the
    // live state: passing literals meant it could only ever return READY, so a condition
    // computeReadinessBlockers stopped covering would pass both gates unnoticed. Read the same
    // state that produced the blockers, so the two can actually disagree.
    const pilotSafety = this.deps.getSafetyState();
    const pilotStatus = pilot.precheck({
      paperOnly: true,
      deploymentIntegrity: pilotSafety.deploymentIntegrity,
      reconciliation: pilotSafety.reconciliation,
      killSwitch: pilotSafety.killSwitch,
      openP0: pilotSafety.openP0,
      marketDataHealthy: this.webSocketConnected && (this.marketDataStatus === "HEALTHY" || this.marketDataStatus === "WARMING_UP"),
      warmedUp: this.officialWarmupComplete() || this.candleAdapter.inspectState().warmupComplete,
      automaticTrading: pilotSafety.automaticTrading
    });
    this.pilot = pilot;
    if (pilotStatus !== "READY") {
      this.lifecycle = "HALTED";
      this.blockers = pilot.snapshot().blockers;
      return this.diagnostics();
    }
    // A fresh bus per session: a halted bus is never reused, and no previous session's
    // queued events can leak into this one.
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
    // Per-session, not per-instance: a fresh session starts with a clean candle history, so
    // last session's final candle can never look like this session's duplicate.
    this.sessionStartedAt = now;
    this.lastAdmittedCandleCloseTime = undefined;
    this.dispatchedCandleCloseTimes.clear();
    this.outOfOrderCandleCount = 0;
    this.duplicateCandleCount = 0;
    this.staleCandleCount = 0;
    // Per session: a previous session's outages are that session's evidence, not this one's.
    this.sessionConnectionEpisodes.clear();
    pilot.start(now);
    this.lifecycle = "RUNNING";
    this.blockers = [];
    this.longRunningDiagnostics.start(sessionId);
    this.publishPendingEvents();
    return this.diagnostics();
  }

  /** Owner-explicit only. Immediately stops new signal dispatch; the underlying session stays open. */
  pause(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "RUNNING") throw new Error(`shadow pause requires RUNNING, currently ${this.lifecycle}`);
    this.lifecycle = "PAUSED";
    this.blockers = ["OWNER_REQUESTED_PAUSE"];
    return this.diagnostics();
  }

  /** Owner-explicit only. Re-runs the full precheck; a healthy market alone never triggers this. */
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

  /**
   * Explicitly releases a completed session before a later owner start. This is deliberately
   * narrower than a restart/recovery operation: halted, failed, or invalidated sessions cannot
   * be cleared here, and every completion must be flushed before its bus and pilot references
   * are released. A new candle adapter also prevents a prior session's high-water mark,
   * duplicate set, or warm-up counters from crossing the session boundary.
   */
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
    this.lastAdmittedCandleCloseTime = undefined;
    this.lastOfficialCandleTime = undefined;
    this.officialClosedCandleCount = 0;
    this.publishedSequence = 0;
    this.outOfOrderCandleCount = 0;
    this.duplicateCandleCount = 0;
    this.staleCandleCount = 0;
    this.dispatchedCandleCloseTimes.clear();
    this.sessionConnectionEpisodes.clear();
    this.lastMarketMessageAt = null;
    this.candleAdapter = createClosedCandleAdapter({ symbol: this.deps.symbol, requiredWarmupCandles: 20 });
    this.candleAdapter.markDisconnected(this.now());
    // The next owner start must observe a fresh connection lifecycle. Keeping this true while
    // the adapter is reset would make the next "connected" callback skip markReconnected and
    // leave the adapter permanently disconnected.
    this.webSocketConnected = false;
    this.marketDataStatus = "DISCONNECTED";
    this.lifecycle = "IDLE";
    this.blockers = [];
    return this.diagnostics();
  }

  diagnostics(): ShadowOperationalDiagnostics {
    this.reflectEvidenceHalt();
    const session: ShadowPilotSession | undefined = this.pilot?.snapshot();
    const candleState = this.candleAdapter.inspectState();
    const closedCandleCount = Math.max(candleState.closedCandleCount, this.officialClosedCandleCount);
    return Object.freeze({
      state: this.lifecycle,
      sessionId: session?.sessionId ?? null,
      symbol: this.deps.symbol,
      strategyId: this.deps.strategyId,
      marketDataStatus: this.marketDataStatus,
      closedCandleCount,
      requiredWarmupCandles: candleState.requiredWarmupCandles,
      warmupComplete: this.officialWarmupComplete() || candleState.warmupComplete,
      lastClosedCandleTime: this.lastClosedCandleTime ?? null,
      lastSignalTime: this.lastSignalTime ?? null,
      startedAt: this.sessionStartedAt ?? null,
      elapsedMs: this.sessionStartedAt === undefined ? 0 : Math.max(0, this.now() - this.sessionStartedAt),
      maxSessionDurationMs: this.deps.maxSessionDurationMs ?? null,
      outOfOrderCandleCount: this.outOfOrderCandleCount,
      duplicateCandleCount: this.duplicateCandleCount,
      staleCandleCount: this.staleCandleCount,
      lastSignal: this.lastSignal ?? null,
      signalCount: session?.counters.signalCount ?? 0,
      hypotheticalOrderCount: session?.counters.hypotheticalOrderCount ?? 0,
      hypotheticalFillCount: session?.counters.hypotheticalFillCount ?? 0,
      actualBrokerCallCount: 0,
      executionGateCallCount: 0,
      actualOrderCount: session?.counters.actualOrderCount ?? 0,
      actualFillCount: session?.counters.actualFillCount ?? 0,
      cashMutationCount: session?.counters.cashMutationCount ?? 0,
      positionMutationCount: session?.counters.positionMutationCount ?? 0,
      blockers: Object.freeze([...this.blockers]),
      automaticResumeAllowed: false,
      marketRecoveryResumeAllowed: this.deps.autoResumeOnMarketRecovery === true,
      marketRecoveryResumeSuggested: this.resumeSuggestedAfterMarketRecovery(),
      marketConnection: this.marketConnection,
      marketFreshness: this.marketFreshness(),
      productionMutationAllowed: false,
      strategyVersion: this.deps.strategyVersion ?? `${this.deps.strategyId}:legacy-ticker-v1`,
      inputType: "CLOSED_CANDLE",
      interval: "1m",
      sourceType: "UPBIT_PUBLIC_CANDLE",
      strategyFingerprint: this.deps.strategyFingerprint ?? this.deps.fingerprints.strategy,
      completionHistory: Object.freeze([...this.completionHistory])
      ,longRunning: this.longRunningDiagnostics.diagnostics()
    });
  }

  private longRunningSourceSnapshot() {
    const session = this.pilot?.snapshot();
    const evidence = this.evidenceBus?.diagnostics();
    const sourceTimestamp = this.lastSignalTime ?? this.lastClosedCandleTime ?? null;
    return {
      timestamp: this.now(),
      sessionId: session?.sessionId ?? null,
      sessionState: this.lifecycle,
      observationStartedAt: this.sessionStartedAt ?? null,
      elapsedTime: this.sessionStartedAt === undefined ? 0 : Math.max(0, this.now() - this.sessionStartedAt),
      signalCount: session?.counters.signalCount ?? 0,
      evidenceCount: evidence?.delivered ?? 0,
      marketListenerCount: Math.max(0, this.deps.getMarketListenerCount?.() ?? 0),
      marketSubscriptionCount: Math.max(0, this.deps.getMarketSubscriptionCount?.() ?? 0),
      hostIntervalCount: Math.max(0, this.deps.getHostIntervalCount?.() ?? 0),
      hostTimeoutCount: Math.max(0, this.deps.getHostTimeoutCount?.() ?? 0),
      lastEventAt: sourceTimestamp,
      lastEvidenceAt: evidence && evidence.delivered > 0 ? sourceTimestamp : null,
      actualOrderCount: session?.counters.actualOrderCount ?? 0,
      actualFillCount: session?.counters.actualFillCount ?? 0,
      cashMutationCount: session?.counters.cashMutationCount ?? 0,
      positionMutationCount: session?.counters.positionMutationCount ?? 0,
      brokerCallCount: 0,
      privateApiCallCount: 0
    };
  }

  private officialWarmupComplete(): boolean {
    return this.officialClosedCandleCount >= 20;
  }
}
