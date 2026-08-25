import { createClosedCandleAdapter, type ClosedCandle, type ClosedCandleAdapter, type PublicTickerSample } from "../strategy/closedCandleAdapter";
import { DEFAULT_MARKET_RECONNECT_POLICY, evaluateMarketFreshness, type MarketConnectionDiagnostics, type MarketConnectionEpisode, type MarketFreshness } from "../exchange/marketConnectionSupervisor";
import type { ShadowMarketDataStatus } from "./shadowOperationalTypes";
import type { UpbitMinuteCandleSource } from "../exchange/upbitMinuteCandleSource";

const ADVERSE_CANDLE_HEALTH_CODES = new Set(["GAP_DETECTED", "OUT_OF_ORDER", "DISCONNECTED"]);

/**
 * A lifecycle action ShadowOperationalRuntime must apply after a market-data state
 * transition -- e.g. "auto-pause a RUNNING session with these reason codes" or "halt the
 * active session". This tracker never applies a lifecycle mutation itself: it has no access
 * to `lifecycle`, `pilot`, or the evidence bus, so it computes what happened to the market
 * data and hands the caller an ordered list of actions to apply in exactly this order --
 * preserving the original code's "later autoPauseIfRunning calls overwrite the blockers set
 * by earlier ones in the same tick" semantics.
 */
export type ShadowMarketAction =
  | { readonly kind: "AUTO_PAUSE"; readonly reasonCodes: readonly string[] }
  | { readonly kind: "HALT"; readonly reasonCodes: readonly string[] };

export interface ShadowWebSocketStatusResult {
  readonly actions: readonly ShadowMarketAction[];
}

export interface ShadowMarketConnectionStateResult {
  readonly actions: readonly ShadowMarketAction[];
  /** Newly-accepted connection episodes (deduplicated, session-scoped) the caller must also record into the pilot's evidence chain. */
  readonly newEpisodes: readonly MarketConnectionEpisode[];
}

export interface ShadowTickerHealthResult {
  readonly actions: readonly ShadowMarketAction[];
  readonly adverse: boolean;
  readonly emittedCandles: readonly ClosedCandle[];
}

/**
 * Owns the market-data health classification concern of ShadowOperationalRuntime (ADR-0015
 * item 4): the closed-candle adapter, connection status, connection diagnostics/episode log,
 * and the public-candle warm-up/history bookkeeping. Every method here is either a pure
 * getter/predicate or a state transition that returns the lifecycle actions the caller must
 * apply -- this tracker itself never reads or writes `lifecycle`, `pilot`, or the evidence bus.
 */
export class ShadowMarketConnectionTracker {
  private candleAdapter: ClosedCandleAdapter;
  private marketDataStatus: ShadowMarketDataStatus = "CONNECTING";
  private webSocketConnected = false;
  private lastOfficialCandleTime?: number;
  private officialClosedCandleCount = 0;
  private closedCandleHistory: readonly ClosedCandle[] = Object.freeze([]);
  private marketConnection: MarketConnectionDiagnostics | null = null;
  private readonly sessionConnectionEpisodes = new Map<number, MarketConnectionEpisode>();
  private lastMarketMessageAt: number | null = null;

  constructor(private readonly symbol: string, now: number) {
    this.candleAdapter = createClosedCandleAdapter({ symbol, requiredWarmupCandles: 20 });
    // The adapter defaults to "connected"; the real stream has not connected yet at
    // construction time, so correct that immediately rather than reporting a false HEALTHY.
    this.candleAdapter.markDisconnected(now);
  }

  status(): ShadowMarketDataStatus {
    return this.marketDataStatus;
  }

  isWebSocketConnected(): boolean {
    return this.webSocketConnected;
  }

  candleAdapterState() {
    return this.candleAdapter.inspectState();
  }

  officialClosedCandleCountValue(): number {
    return this.officialClosedCandleCount;
  }

  /** Bounded, read-only public-market history for the localhost mobile monitor. */
  recentClosedCandles(limit = 200): readonly ClosedCandle[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze([]);
    return Object.freeze(this.closedCandleHistory.slice(-Math.min(200, limit)));
  }

  /** Called by ShadowOperationalRuntime.onClosedCandle, exactly where the original inline body called it. */
  rememberClosedCandle(candle: ClosedCandle): void {
    if (candle.source !== "UPBIT_PUBLIC_CANDLE") return;
    if (this.closedCandleHistory.some((item) => item.openTime === candle.openTime)) return;
    this.closedCandleHistory = Object.freeze([...this.closedCandleHistory, candle].sort((left, right) => left.openTime - right.openTime).slice(-200));
  }

  /** Sets marketDataStatus directly for syncOfficialCandles's catch path (ShadowOperationalRuntime.syncOfficialCandles). */
  markOfficialCandleSourceError(status: "GAP_DETECTED" | "STALE"): void {
    this.marketDataStatus = status;
  }

  officialWarmupComplete(): boolean {
    return this.officialClosedCandleCount >= 20;
  }

  /** Read-only. Null until a connection supervisor has reported (WO-0034-A4L). */
  marketConnectionDiagnostics(): MarketConnectionDiagnostics | null {
    return this.marketConnection;
  }

  /** Connection episodes recorded for the current session, in order. */
  marketConnectionEpisodes(): readonly MarketConnectionEpisode[] {
    return Object.freeze([...this.sessionConnectionEpisodes.values()].sort((left, right) => left.episodeId - right.episodeId));
  }

  marketFreshness(lastClosedCandleTime: number | undefined, toleranceMs: number | undefined, now: number): MarketFreshness {
    return evaluateMarketFreshness({
      now,
      lastMessageAt: this.lastMarketMessageAt,
      latestCandleCloseTime: lastClosedCandleTime ?? null,
      toleranceMs: toleranceMs ?? DEFAULT_MARKET_RECONNECT_POLICY.staleAfterMs
    });
  }

  /**
   * Real Upbit WebSocket connection-status callback, forwarded from main.ts's
   * handleMarketStatus, via ShadowOperationalRuntime.onWebSocketStatus. Body moved verbatim
   * (ADR-0015 item 4): every `autoPauseIfRunning`/lifecycle write in the original becomes an
   * action in the returned, ordered list instead.
   */
  onWebSocketStatus(status: string, now: number): ShadowWebSocketStatusResult {
    const actions: ShadowMarketAction[] = [];
    if (status === "connected") {
      const wasConnected = this.webSocketConnected;
      this.webSocketConnected = true;
      if (!wasConnected) this.candleAdapter.markReconnected(now);
      if (!wasConnected) {
        this.lastOfficialCandleTime = undefined;
        this.officialClosedCandleCount = 0;
        actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_RECONNECTED_REQUIRES_WARMUP"] });
      }
      this.marketDataStatus = this.candleAdapter.inspectState().warmupComplete ? "HEALTHY" : "WARMING_UP";
      return { actions };
    }
    if (status === "reconnect-exhausted") {
      this.webSocketConnected = false;
      this.candleAdapter.markDisconnected(now);
      this.candleAdapter.dropOpenCandle();
      this.marketDataStatus = "DISCONNECTED";
      actions.push({ kind: "HALT", reasonCodes: ["MARKET_DATA_DISCONNECTED_EXHAUSTED"] });
      return { actions };
    }
    if (status.startsWith("reconnecting")) {
      this.webSocketConnected = false;
      this.candleAdapter.markDisconnected(now);
      // The minute being assembled when the feed dropped is discarded rather than resumed:
      // ticks from either side of an outage are not one minute of trading (WO-0034-A4L).
      this.candleAdapter.dropOpenCandle();
      this.marketDataStatus = "RECONNECTING";
      actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_RECONNECTING"] });
      return { actions };
    }
    if (status === "connecting") {
      this.marketDataStatus = this.webSocketConnected ? "RECONNECTING" : "CONNECTING";
      return { actions };
    }
    if (status.startsWith("stale")) {
      this.marketDataStatus = "STALE";
      actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_STALE"] });
      return { actions };
    }
    if (status.startsWith("error") || status.startsWith("decode-error")) {
      actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_DEGRADED"] });
    }
    return { actions };
  }

  /**
   * Structured public-feed connection state (WO-0034-A4L), forwarded from
   * ShadowOperationalRuntime.onMarketConnectionState. Body moved verbatim; episode recording
   * into the pilot's hash chain stays the caller's job (it needs `pilot` and
   * `publishPendingEvents`, which this tracker does not have), so this returns the newly
   * accepted episodes instead of writing them into the archive directly.
   */
  onMarketConnectionState(diagnostics: MarketConnectionDiagnostics, sessionStartedAt: number | undefined): ShadowMarketConnectionStateResult {
    this.marketConnection = diagnostics;
    if (diagnostics.lastMarketMessageAt !== null) this.lastMarketMessageAt = diagnostics.lastMarketMessageAt;
    const newEpisodes = this.acceptNewEpisodes(diagnostics.episodes, sessionStartedAt);
    const actions: ShadowMarketAction[] = [];
    switch (diagnostics.marketConnectionState) {
      case "FAILED": {
        this.marketDataStatus = "DISCONNECTED";
        const reason = diagnostics.reconnectFailureReason;
        actions.push({ kind: "HALT", reasonCodes: reason === null ? ["MARKET_RECONNECT_TIMEOUT"] : ["MARKET_RECONNECT_TIMEOUT", reason] });
        return { actions, newEpisodes };
      }
      case "DISCONNECTED":
      case "RECONNECTING": {
        // `reconnectStartedAt` is null until a disconnection episode opens, which is how a
        // first connection attempt is told apart from a reconnection. Reporting the initial
        // dial-up as RECONNECTING would show a recovery from a connection that never existed.
        const inEpisode = diagnostics.reconnectStartedAt !== null;
        this.marketDataStatus = inEpisode ? "RECONNECTING" : "CONNECTING";
        if (inEpisode) actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_RECONNECTING"] });
        return { actions, newEpisodes };
      }
      case "STALE":
        this.marketDataStatus = "STALE";
        actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_STALE"] });
        return { actions, newEpisodes };
      default:
        // CONNECTED and RECOVERED do NOT resume anything here. An open socket is not a
        // delivering feed; resumption is attempted from the data path, once real market data
        // has actually arrived and the warm-up it reset has been rebuilt.
        return { actions, newEpisodes };
    }
  }

  /** Accepts and remembers the episodes belonging to the current session; returns only the newly-accepted ones, in order. */
  private acceptNewEpisodes(episodes: readonly MarketConnectionEpisode[], sessionStartedAt: number | undefined): readonly MarketConnectionEpisode[] {
    if (sessionStartedAt === undefined) return Object.freeze([]);
    const accepted: MarketConnectionEpisode[] = [];
    for (const episode of episodes) {
      // An episode already open when the session began cannot exist: the start precheck
      // blocks on MARKET_DATA_DISCONNECTED, so a session can only begin with the feed up.
      if (episode.disconnectedAt < sessionStartedAt) continue;
      if (this.sessionConnectionEpisodes.has(episode.episodeId)) continue;
      this.sessionConnectionEpisodes.set(episode.episodeId, episode);
      accepted.push(episode);
    }
    return Object.freeze(accepted);
  }

  /**
   * Real accepted public ticker, forwarded from ShadowOperationalRuntime.onTicker. Body moved
   * verbatim through the candle-health classification; the caller still owns dispatching each
   * emitted candle (onClosedCandle) and the resume attempt, since both touch state this
   * tracker does not own.
   */
  onTicker(ticker: PublicTickerSample, now: number, clockDriftToleranceMs: number): ShadowTickerHealthResult {
    const actions: ShadowMarketAction[] = [];
    this.lastMarketMessageAt = now;
    const drifted = Math.abs(now - ticker.trade_timestamp) > clockDriftToleranceMs;
    if (drifted) {
      this.marketDataStatus = "CLOCK_DRIFT";
      actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_CLOCK_DRIFT"] });
    }
    const result = this.candleAdapter.ingestTicker(ticker);
    let adverse = drifted;
    for (const event of result.healthEvents) {
      if (event.code === "GAP_DETECTED") { this.marketDataStatus = "GAP_DETECTED"; actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_GAP_DETECTED"] }); }
      else if (event.code === "OUT_OF_ORDER") { this.marketDataStatus = "OUT_OF_ORDER"; actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_OUT_OF_ORDER"] }); }
      else if (event.code === "DISCONNECTED") { this.marketDataStatus = "DISCONNECTED"; actions.push({ kind: "AUTO_PAUSE", reasonCodes: ["MARKET_DATA_DISCONNECTED"] }); }
      if (ADVERSE_CANDLE_HEALTH_CODES.has(event.code)) adverse = true;
    }
    if (!adverse) this.marketDataStatus = this.candleAdapter.inspectState().warmupComplete ? "HEALTHY" : "WARMING_UP";
    return { actions, adverse, emittedCandles: adverse ? Object.freeze([]) : result.emittedCandles };
  }

  /** Official closed-candle source path. Returns the accepted candles for the caller to dispatch, in order. */
  async syncOfficialCandles(source: UpbitMinuteCandleSource): Promise<
    { readonly candles: readonly ClosedCandle[] } | { readonly error: "GAP_DETECTED" | "STALE" }
  > {
    try {
      const accepted: ClosedCandle[] = [];
      for (const candle of await source.loadClosedCandles(200)) {
        if (this.lastOfficialCandleTime !== undefined && candle.openTime <= this.lastOfficialCandleTime) continue;
        this.lastOfficialCandleTime = candle.openTime;
        this.officialClosedCandleCount += 1;
        const closedCandle: ClosedCandle = { symbol: candle.symbol, interval: candle.interval, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, volumeAvailable: true, tradeCount: 0, closed: true, sequence: candle.openTime, source: "UPBIT_PUBLIC_CANDLE" };
        accepted.push(closedCandle);
      }
      return { candles: Object.freeze(accepted) };
    } catch (error) {
      return { error: error instanceof Error && error.message.includes("missing interval") ? "GAP_DETECTED" : "STALE" };
    }
  }

  /** Resets every field this tracker owns for the next session (ShadowOperationalRuntime.prepareForNextSession). */
  resetForNextSession(now: number): void {
    this.lastOfficialCandleTime = undefined;
    this.officialClosedCandleCount = 0;
    this.sessionConnectionEpisodes.clear();
    this.lastMarketMessageAt = null;
    this.candleAdapter = createClosedCandleAdapter({ symbol: this.symbol, requiredWarmupCandles: 20 });
    this.candleAdapter.markDisconnected(now);
    // The next owner start must observe a fresh connection lifecycle. Keeping this true while
    // the adapter is reset would make the next "connected" callback skip markReconnected and
    // leave the adapter permanently disconnected.
    this.webSocketConnected = false;
    this.marketDataStatus = "DISCONNECTED";
  }

  /** Clears per-session episode/candle-sequence state when a fresh session starts (ShadowOperationalRuntime.start()). */
  resetForNewSession(): void {
    this.sessionConnectionEpisodes.clear();
  }
}
