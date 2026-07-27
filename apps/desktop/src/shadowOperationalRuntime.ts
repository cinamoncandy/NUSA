import { randomUUID } from "node:crypto";
import type { StrategySignal, TradingStrategy } from "./strategyEngine";
import type { OperationalCandle } from "./upbitMinuteCandleSource";

export type MarketDataRuntimeState = "DISCONNECTED" | "CONNECTING" | "WARMING_UP" | "HEALTHY" | "STALE" | "RECONNECTING" | "GAP_DETECTED" | "OUT_OF_ORDER" | "CLOCK_DRIFT";
export type ShadowExecutionRuntimeState = "IDLE" | "PRECHECK" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "HALTED" | "INVALIDATED" | "FAILED";
export type ShadowEventType = "MARKET_CONNECTED" | "MARKET_WARMING_UP" | "CANDLE_CLOSED" | "CANDLE_REJECTED" | "WARMUP_COMPLETED" | "SHADOW_PRECHECK_REQUESTED" | "SHADOW_READY" | "SHADOW_STARTED" | "SHADOW_PAUSED" | "SHADOW_RESUME_REQUESTED" | "SHADOW_RESUMED" | "SHADOW_STOPPED" | "SHADOW_INVALIDATED" | "STRATEGY_SIGNAL" | "RISK_ALLOW" | "RISK_REJECT" | "RISK_HALT" | "HYPOTHETICAL_ORDER" | "HYPOTHETICAL_FILL" | "MARKET_STALE" | "MARKET_RECONNECTING" | "MARKET_GAP" | "MARKET_OUT_OF_ORDER" | "RESTART_DETECTED";

export interface ShadowDomainEvent {
  readonly eventType: ShadowEventType;
  readonly runtimeSequence: number;
  readonly occurredAt: number;
  readonly sourceCommitSha: string;
  readonly strategyVersion: string;
  readonly symbol: string;
  readonly sessionId: string | null;
  readonly candleId: string | null;
  readonly signalId: string | null;
  readonly reasonCodes: readonly string[];
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ShadowEventSink { append(event: ShadowDomainEvent): void; }

export class InMemoryShadowEventSink implements ShadowEventSink {
  private readonly events: ShadowDomainEvent[] = [];
  constructor(private readonly maximumEvents = 2_000) { if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1) throw new Error("maximumEvents must be positive"); }
  append(event: ShadowDomainEvent): void { this.events.push(Object.freeze({ ...event, reasonCodes: Object.freeze([...event.reasonCodes]), payload: Object.freeze({ ...event.payload }) })); if (this.events.length > this.maximumEvents) this.events.splice(0, this.events.length - this.maximumEvents); }
  list(): readonly ShadowDomainEvent[] { return Object.freeze(this.events.map((event) => Object.freeze({ ...event, reasonCodes: Object.freeze([...event.reasonCodes]), payload: Object.freeze({ ...event.payload }) }))); }
}

export interface ShadowRiskEvaluator { evaluate(input: Readonly<{ path: "STRATEGY"; side: "BUY" | "SELL"; quantity: number; price: number }>): Readonly<{ status: "ALLOW" | "REJECT" | "HALT"; reasonCodes: readonly string[] }>; }
export interface ShadowExecutionAdapter { execute(input: Readonly<{ sessionId: string; signalId: string; side: "BUY" | "SELL"; quantity: number; price: number; candleId: string }>): Readonly<{ hypotheticalOrderId: string; hypotheticalFillId: string }>; }

export class InMemoryShadowExecutionAdapter implements ShadowExecutionAdapter {
  execute(input: Readonly<{ sessionId: string; signalId: string; side: "BUY" | "SELL"; quantity: number; price: number; candleId: string }>): Readonly<{ hypotheticalOrderId: string; hypotheticalFillId: string }> {
    return Object.freeze({ hypotheticalOrderId: `shadow-order:${input.sessionId}:${input.signalId}`, hypotheticalFillId: `shadow-fill:${input.sessionId}:${input.signalId}` });
  }
}

export interface ShadowOperationalRuntimeOptions {
  readonly symbol: string;
  readonly strategy: TradingStrategy;
  readonly strategyVersion: string;
  readonly strategyFingerprint?: string;
  readonly sourceCommitSha: string;
  readonly requiredWarmupCandles: number;
  readonly hypotheticalQuantity: number;
  readonly riskEvaluator: ShadowRiskEvaluator;
  readonly execution?: ShadowExecutionAdapter;
  readonly eventSink?: ShadowEventSink;
  readonly clock?: () => number;
  readonly sessionIdFactory?: () => string;
}

export interface ShadowOperationalSnapshot {
  readonly marketDataState: MarketDataRuntimeState;
  readonly shadowState: ShadowExecutionRuntimeState;
  readonly symbol: string;
  readonly strategyVersion: string;
  readonly strategyFingerprint: string | null;
  readonly sessionId: string | null;
  readonly validClosedCandleCount: number;
  readonly requiredWarmupCandles: number;
  readonly warmupComplete: boolean;
  readonly currentOpenCandleInvalidated: boolean;
  readonly signalCount: number;
  readonly hypotheticalOrderCount: number;
  readonly hypotheticalFillCount: number;
  readonly actualBrokerCallCount: 0;
  readonly actualOrderCount: 0;
  readonly actualFillCount: 0;
  readonly cashMutationCount: 0;
  readonly positionMutationCount: 0;
  readonly blockers: readonly string[];
  readonly automaticResumeAllowed: false;
  readonly productionMutationAllowed: false;
}

export class ShadowOperationalRuntime {
  private marketDataState: MarketDataRuntimeState = "DISCONNECTED";
  private shadowState: ShadowExecutionRuntimeState = "IDLE";
  private readonly sink: ShadowEventSink;
  private readonly clock: () => number;
  private readonly sessionIdFactory: () => string;
  private readonly execution: ShadowExecutionAdapter;
  private timer?: NodeJS.Timeout;
  private sessionId: string | null = null;
  private lastCandle?: OperationalCandle;
  private closes: number[] = [];
  private validClosedCandleCount = 0;
  private signalCount = 0;
  private hypotheticalOrderCount = 0;
  private hypotheticalFillCount = 0;
  private currentOpenCandleInvalidated = false;
  private blockers: string[] = [];
  private sequence = 0;
  private ownerStarted = false;

  constructor(private readonly options: ShadowOperationalRuntimeOptions, private readonly source?: { loadClosedCandles(count?: number): Promise<readonly OperationalCandle[]> }) {
    if (!options.symbol || !options.strategyVersion || !/^[a-f0-9]{40}$/.test(options.sourceCommitSha)) throw new Error("invalid Shadow runtime identity");
    if (!Number.isSafeInteger(options.requiredWarmupCandles) || options.requiredWarmupCandles < 1 || !Number.isFinite(options.hypotheticalQuantity) || options.hypotheticalQuantity <= 0) throw new Error("invalid Shadow runtime configuration");
    this.sink = options.eventSink ?? new InMemoryShadowEventSink();
    this.clock = options.clock ?? Date.now;
    this.sessionIdFactory = options.sessionIdFactory ?? randomUUID;
    this.execution = options.execution ?? new InMemoryShadowExecutionAdapter();
  }

  startMarketData(): void { if (this.timer || !this.source) return; this.marketDataState = "WARMING_UP"; this.timer = setInterval(() => { void this.syncMarketData(); }, 60_000); void this.syncMarketData(); }
  stopMarketData(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async syncMarketData(): Promise<void> {
    if (!this.source || this.marketDataState === "RECONNECTING" || this.marketDataState === "DISCONNECTED") return;
    try { this.acceptCandles(await this.source.loadClosedCandles(200)); } catch (error) { this.marketDataState = error instanceof Error && error.message.includes("missing interval") ? "GAP_DETECTED" : "STALE"; this.blockers = ["MARKET_DATA_SOURCE_UNAVAILABLE"]; this.emit(this.marketDataState === "GAP_DETECTED" ? "MARKET_GAP" : "MARKET_STALE", ["MARKET_DATA_SOURCE_UNAVAILABLE"], {}); }
  }

  onMarketStatus(status: string): void {
    if (status === "connected") { this.marketDataState = "WARMING_UP"; this.emit("MARKET_CONNECTED", [], {}); return; }
    if (status === "connecting" || status.startsWith("reconnecting")) { this.disconnect("MARKET_RECONNECTING"); return; }
    if (status.startsWith("stale")) { this.marketDataState = "STALE"; if (this.sessionId) this.pauseOwner(this.sessionId, ["MARKET_DATA_STALE"]); this.emit("MARKET_STALE", ["MARKET_DATA_STALE"], {}); return; }
    if (status.startsWith("error")) this.disconnect("MARKET_RECONNECTING");
  }

  acceptCandles(candles: readonly OperationalCandle[]): void {
    if (this.marketDataState === "DISCONNECTED" || this.marketDataState === "RECONNECTING") return;
    for (const candle of candles) this.acceptCandle(candle);
  }

  acceptCandle(candle: OperationalCandle): void {
    if (candle.symbol !== this.options.symbol || candle.qualityStatus !== "VALID" || !candle.closeConfirmed || candle.interval !== "1m") { this.emit("CANDLE_REJECTED", ["CANDLE_QUALITY_INVALID"], { candleId: candle.candleId }); return; }
    if (this.lastCandle && candle.openTime <= this.lastCandle.openTime) return;
    if (this.lastCandle && candle.openTime !== this.lastCandle.openTime + 60_000) { this.marketDataState = "GAP_DETECTED"; this.invalidate("MARKET_DATA_GAP"); this.emit("MARKET_GAP", ["MARKET_DATA_GAP"], { candleId: candle.candleId }); return; }
    this.lastCandle = candle;
    this.closes.push(candle.close);
    this.validClosedCandleCount += 1;
    this.emit("CANDLE_CLOSED", [], { candleId: candle.candleId, closeTime: candle.closeTime });
    if (!this.ownerStarted) {
      this.marketDataState = "WARMING_UP";
      if (this.validClosedCandleCount >= this.options.requiredWarmupCandles) { this.marketDataState = "HEALTHY"; this.shadowState = "READY"; this.emit("WARMUP_COMPLETED", [], { count: this.validClosedCandleCount }); this.emit("SHADOW_READY", [], {}); }
      return;
    }
    if (this.shadowState !== "RUNNING") return;
    const signal = this.options.strategy.onTick({ market: this.options.symbol, price: candle.close, timestamp: candle.closeTime }, { market: this.options.symbol, prices: this.closes.slice(0, -1), positionQuantity: 0 });
    this.signalCount += 1;
    const signalId = `${this.sessionId}:${candle.candleId}:${signal.type}`;
    this.emit("STRATEGY_SIGNAL", [], { signalId, type: signal.type, confidence: signal.confidence });
    if (signal.type === "HOLD") return;
    const decision = this.options.riskEvaluator.evaluate({ path: "STRATEGY", side: signal.type, quantity: this.options.hypotheticalQuantity, price: candle.close });
    const riskEvent = decision.status === "ALLOW" ? "RISK_ALLOW" : decision.status === "HALT" ? "RISK_HALT" : "RISK_REJECT";
    this.emit(riskEvent, decision.reasonCodes, { signalId });
    if (decision.status !== "ALLOW") { if (decision.status === "HALT") this.shadowState = "HALTED"; return; }
    const order = this.execution.execute({ sessionId: this.sessionId!, signalId, side: signal.type, quantity: this.options.hypotheticalQuantity, price: candle.close, candleId: candle.candleId });
    this.hypotheticalOrderCount += 1; this.hypotheticalFillCount += 1;
    this.emit("HYPOTHETICAL_ORDER", [], { signalId, hypotheticalOrderId: order.hypotheticalOrderId });
    this.emit("HYPOTHETICAL_FILL", [], { signalId, hypotheticalFillId: order.hypotheticalFillId });
  }

  startOwner(): ShadowOperationalSnapshot {
    this.emit("SHADOW_PRECHECK_REQUESTED", [], {});
    if (this.shadowState !== "READY" || this.marketDataState !== "HEALTHY" || this.validClosedCandleCount < this.options.requiredWarmupCandles) throw new Error("Shadow owner requires healthy market data and completed warm-up");
    this.sessionId = this.sessionIdFactory();
    if (!this.sessionId) throw new Error("Shadow session identity is required");
    this.options.strategy.reset(); this.ownerStarted = true; this.shadowState = "RUNNING"; this.emit("SHADOW_STARTED", [], {}); return this.snapshot();
  }

  pauseOwner(sessionId: string, reasonCodes: readonly string[] = ["OWNER_PAUSED"]): ShadowOperationalSnapshot { this.requireSession(sessionId); if (!this.ownerStarted || this.shadowState !== "RUNNING") throw new Error("Shadow owner is not running"); this.ownerStarted = false; this.shadowState = "PAUSED"; this.blockers = [...reasonCodes].sort(); this.emit("SHADOW_PAUSED", this.blockers, {}); return this.snapshot(); }
  resumeOwner(sessionId: string): ShadowOperationalSnapshot { this.requireSession(sessionId); if (this.shadowState !== "PAUSED" || this.marketDataState !== "HEALTHY") throw new Error("Shadow resume requires a healthy paused session"); this.shadowState = "RUNNING"; this.ownerStarted = true; this.emit("SHADOW_RESUME_REQUESTED", [], {}); this.emit("SHADOW_RESUMED", [], {}); return this.snapshot(); }
  stopOwner(sessionId: string): ShadowOperationalSnapshot { this.requireSession(sessionId); this.ownerStarted = false; this.shadowState = "COMPLETED"; this.emit("SHADOW_STOPPED", [], {}); return this.snapshot(); }

  disconnect(reason: string): void { this.marketDataState = "RECONNECTING"; this.invalidate(reason); this.emit("MARKET_RECONNECTING", [reason], {}); }
  restart(): void { this.ownerStarted = false; this.sessionId = null; this.marketDataState = "WARMING_UP"; this.resetWarmup(); this.emit("RESTART_DETECTED", ["RESTART_DETECTED"], {}); }
  snapshot(): ShadowOperationalSnapshot { return Object.freeze({ marketDataState: this.marketDataState, shadowState: this.shadowState, symbol: this.options.symbol, strategyVersion: this.options.strategyVersion, strategyFingerprint: this.options.strategyFingerprint ?? null, sessionId: this.sessionId, validClosedCandleCount: this.validClosedCandleCount, requiredWarmupCandles: this.options.requiredWarmupCandles, warmupComplete: this.validClosedCandleCount >= this.options.requiredWarmupCandles, currentOpenCandleInvalidated: this.currentOpenCandleInvalidated, signalCount: this.signalCount, hypotheticalOrderCount: this.hypotheticalOrderCount, hypotheticalFillCount: this.hypotheticalFillCount, actualBrokerCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0, blockers: Object.freeze([...this.blockers]), automaticResumeAllowed: false, productionMutationAllowed: false }); }
  events(): readonly ShadowDomainEvent[] { return this.sink instanceof InMemoryShadowEventSink ? this.sink.list() : Object.freeze([]); }

  private resetWarmup(): void { this.lastCandle = undefined; this.closes = []; this.validClosedCandleCount = 0; this.currentOpenCandleInvalidated = false; this.options.strategy.reset(); this.shadowState = "IDLE"; this.ownerStarted = false; }
  private invalidate(reason: string): void { this.currentOpenCandleInvalidated = true; this.resetWarmup(); this.shadowState = "INVALIDATED"; this.ownerStarted = false; this.emit("SHADOW_INVALIDATED", [reason], {}); }
  private requireSession(sessionId: string): void { if (!sessionId || this.sessionId !== sessionId) throw new Error("Shadow session mismatch"); }
  private emit(eventType: ShadowEventType, reasonCodes: readonly string[], payload: Readonly<Record<string, string | number | boolean | null>>): void { this.sink.append(Object.freeze({ eventType, runtimeSequence: this.sequence++, occurredAt: this.clock(), sourceCommitSha: this.options.sourceCommitSha, strategyVersion: this.options.strategyVersion, symbol: this.options.symbol, sessionId: this.sessionId, candleId: typeof payload.candleId === "string" ? payload.candleId : null, signalId: typeof payload.signalId === "string" ? payload.signalId : null, reasonCodes: Object.freeze([...reasonCodes].sort()), payload: Object.freeze({ ...payload }) })); }
}
