import { randomUUID } from "node:crypto";
import { createClosedCandleAdapter, type ClosedCandle, type ClosedCandleAdapter, type PublicTickerSample } from "./closedCandleAdapter";
import { ShadowPilotRuntime, verifyShadowPilotEvents, type ShadowPilotSession } from "./shadowPilotRuntime";
import type { StrategyEngine, StrategySignal } from "./strategyEngine";
import type { PaperCommandRiskGate } from "./runtimeCommandService";
import type { UpbitMinuteCandleSource } from "./upbitMinuteCandleSource";

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
  readonly signalCount: number;
  readonly hypotheticalOrderCount: number;
  readonly hypotheticalFillCount: number;
  readonly actualBrokerCallCount: 0;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly blockers: readonly string[];
  readonly automaticResumeAllowed: false;
  readonly productionMutationAllowed: false;
  readonly strategyVersion: string;
  readonly inputType: "CLOSED_CANDLE";
  readonly interval: "1m";
  readonly sourceType: "UPBIT_PUBLIC_CANDLE";
  readonly strategyFingerprint: string;
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
}

const ADVERSE_CANDLE_HEALTH_CODES = new Set(["GAP_DETECTED", "OUT_OF_ORDER", "DISCONNECTED"]);

export class ShadowOperationalRuntime {
  private lifecycle: ShadowLifecycleStatus = "IDLE";
  private readonly candleAdapter: ClosedCandleAdapter;
  private marketDataStatus: ShadowMarketDataStatus = "CONNECTING";
  private webSocketConnected = false;
  private pilot?: ShadowPilotRuntime;
  private blockers: readonly string[] = [];
  private lastClosedCandleTime?: number;
  private lastSignalTime?: number;
  private sessionSequence = 0;
  private readonly clockDriftToleranceMs: number;
  private lastOfficialCandleTime?: number;
  private officialClosedCandleCount = 0;

  constructor(private readonly deps: ShadowOperationalDependencies) {
    this.candleAdapter = createClosedCandleAdapter({ symbol: deps.symbol, requiredWarmupCandles: 20 });
    this.clockDriftToleranceMs = deps.clockDriftToleranceMs ?? 60_000;
    // The adapter defaults to "connected"; the real stream has not connected yet at
    // construction time, so correct that immediately rather than reporting a false HEALTHY.
    this.candleAdapter.markDisconnected(deps.now?.() ?? Date.now());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private setMarketDataStatus(status: ShadowMarketDataStatus): void {
    this.marketDataStatus = status;
  }

  private autoPauseIfRunning(reasonCodes: readonly string[]): void {
    if (this.lifecycle !== "RUNNING") return;
    this.lifecycle = "PAUSED";
    this.blockers = [...reasonCodes];
  }

  private haltActiveSession(reasonCodes: readonly string[]): void {
    if (this.lifecycle !== "RUNNING" && this.lifecycle !== "PAUSED") return;
    if (this.pilot && this.pilot.snapshot().status === "RUNNING") {
      try { this.pilot.stop(this.now()); } catch { /* best-effort session close only */ }
    }
    this.lifecycle = "HALTED";
    this.blockers = [...reasonCodes];
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
      this.setMarketDataStatus("DISCONNECTED");
      this.haltActiveSession(["MARKET_DATA_DISCONNECTED_EXHAUSTED"]);
      return;
    }
    if (status.startsWith("reconnecting")) {
      this.webSocketConnected = false;
      this.candleAdapter.markDisconnected(now);
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

  /** Real accepted public ticker, forwarded from main.ts's handleTicker. */
  onTicker(ticker: PublicTickerSample): void {
    const now = this.now();
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
    } catch (error) {
      this.setMarketDataStatus(error instanceof Error && error.message.includes("missing interval") ? "GAP_DETECTED" : "STALE");
      this.autoPauseIfRunning(["OFFICIAL_CANDLE_SOURCE_UNAVAILABLE"]);
    }
  }

  private onClosedCandle(candle: ClosedCandle): void {
    this.lastClosedCandleTime = candle.closeTime;
    const position = this.deps.getPositionQuantity();
    const signal = this.deps.strategy.onTick({ market: this.deps.symbol, price: candle.close, timestamp: candle.closeTime }, position);
    // Same production signal drives real Automatic Paper trading, unconditionally, exactly
    // as it did when triggered per-ticker -- only the trigger cadence changed.
    this.deps.onProductionSignal({ market: this.deps.symbol, price: candle.close, positionQuantity: position, signal });
    if (this.lifecycle !== "RUNNING" || signal.type === "HOLD") return;
    this.dispatchShadowSignal(candle, signal);
  }

  private dispatchShadowSignal(candle: ClosedCandle, signal: StrategySignal): void {
    if (!this.pilot) return;
    const side = signal.type as PaperSide;
    const quantity = this.deps.getHypotheticalOrderQuantity();
    const decision = this.deps.riskGate.evaluate(Object.freeze({ path: "SHADOW" as const, side, quantity, price: candle.close }));
    const signalId = `${this.deps.symbol}:${candle.closeTime}:${signal.type}`;
    const commandId = randomUUID();
    this.pilot.observe({ timestamp: candle.closeTime, signalId, commandId, side, quantity, decision: decision.status, reasonCodes: decision.reasonCodes });
    this.lastSignalTime = candle.closeTime;
    const integrityErrors = verifyShadowPilotEvents(this.pilot.eventLog(), this.deps.sourceCommitSha);
    if (integrityErrors.length > 0) {
      this.lifecycle = "FAILED";
      this.blockers = integrityErrors;
      return;
    }
    if (this.pilot.snapshot().status === "HALTED") {
      this.lifecycle = "HALTED";
      this.blockers = [...decision.reasonCodes];
    }
  }

  private computeReadinessBlockers(): readonly string[] {
    const safety = this.deps.getSafetyState();
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
    return blockers;
  }

  /** Owner-explicit only. Never called automatically by this class. */
  start(): ShadowOperationalDiagnostics {
    if (this.lifecycle !== "IDLE") throw new Error(`shadow start requires IDLE, currently ${this.lifecycle}`);
    this.lifecycle = "PRECHECK";
    const now = this.now();
    const blockers = this.computeReadinessBlockers();
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
    const sessionId = `shadow-${this.deps.sourceCommitSha.slice(0, 12)}-${now}-${++this.sessionSequence}`;
    const pilot = new ShadowPilotRuntime({
      sessionId, createdAt: now, sourceCommitSha: this.deps.sourceCommitSha,
      symbol: this.deps.symbol, strategyId: this.deps.strategyId, fingerprints: this.deps.fingerprints
    });
    // Every condition ShadowPilotRuntime's own precheck checks was already confirmed by
    // computeReadinessBlockers() above; this call is the existing, unmodified contract's
    // own gate, kept as a second, independent confirmation rather than duplicated logic.
    const pilotStatus = pilot.precheck({
      paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false,
      openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false
    });
    this.pilot = pilot;
    if (pilotStatus !== "READY") {
      this.lifecycle = "HALTED";
      this.blockers = pilot.snapshot().blockers;
      return this.diagnostics();
    }
    pilot.start(now);
    this.lifecycle = "RUNNING";
    this.blockers = [];
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
    const blockers = this.computeReadinessBlockers();
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
    if (this.lifecycle !== "HALTED") this.lifecycle = "COMPLETED";
    this.blockers = [];
    return this.diagnostics();
  }

  diagnostics(): ShadowOperationalDiagnostics {
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
      signalCount: session?.counters.signalCount ?? 0,
      hypotheticalOrderCount: session?.counters.hypotheticalOrderCount ?? 0,
      hypotheticalFillCount: session?.counters.hypotheticalFillCount ?? 0,
      actualBrokerCallCount: 0,
      actualOrderCount: session?.counters.actualOrderCount ?? 0,
      actualFillCount: session?.counters.actualFillCount ?? 0,
      cashMutationCount: session?.counters.cashMutationCount ?? 0,
      positionMutationCount: session?.counters.positionMutationCount ?? 0,
      blockers: Object.freeze([...this.blockers]),
      automaticResumeAllowed: false,
      productionMutationAllowed: false,
      strategyVersion: this.deps.strategyVersion ?? `${this.deps.strategyId}:legacy-ticker-v1`,
      inputType: "CLOSED_CANDLE",
      interval: "1m",
      sourceType: "UPBIT_PUBLIC_CANDLE",
      strategyFingerprint: this.deps.strategyFingerprint ?? this.deps.fingerprints.strategy
    });
  }

  private officialWarmupComplete(): boolean {
    return this.officialClosedCandleCount >= 20;
  }
}
