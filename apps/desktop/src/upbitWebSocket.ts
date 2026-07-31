import WebSocket from "ws";
import {
  DEFAULT_MARKET_RECONNECT_POLICY,
  MarketConnectionSupervisor,
  evaluateMarketFreshness,
  type MarketConnectionDiagnostics,
  type MarketReconnectPolicy
} from "./marketConnectionSupervisor";

export interface UpbitTicker {
  type: "ticker";
  code: string;
  trade_price: number;
  trade_timestamp: number;
  signed_change_rate?: number;
  /** Upbit's per-ticker base-asset volume, not the 24h quote turnover field. */
  acc_trade_volume?: number;
  acc_trade_price_24h?: number;
}

export interface UpbitMarketSnapshot {
  readonly generatedAt: number;
  readonly tickers: readonly UpbitTicker[];
}

export type UpbitStreamHealth = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE" | "DEGRADED";
export type TickerHandler = (ticker: UpbitTicker) => void;
export type StatusHandler = (status: string) => void;
/** Structured counterpart to StatusHandler. Carries state, never a string to be re-parsed. */
export type ConnectionStateHandler = (diagnostics: MarketConnectionDiagnostics) => void;

export function normalizeUpbitMarkets(markets: string | readonly string[]): string[] {
  const values = (Array.isArray(markets) ? markets : [markets])
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length === 0) throw new Error("at least one Upbit market is required");
  return unique;
}

export function upbitReconnectDelay(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive safe integer");
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
}

export function shouldAcceptUpbitTicker(
  ticker: UpbitTicker,
  subscribedMarkets: readonly string[],
  previousTimestamp?: number
): boolean {
  return ticker.type === "ticker"
    && subscribedMarkets.includes(ticker.code)
    && Number.isFinite(ticker.trade_price)
    && ticker.trade_price > 0
    && Number.isSafeInteger(ticker.trade_timestamp)
    && ticker.trade_timestamp > 0
    && (previousTimestamp == null || ticker.trade_timestamp > previousTimestamp);
}

export interface UpbitWebSocketOptions {
  readonly policy?: MarketReconnectPolicy;
  /** Structured connection-state callback (WO-0034-A4L). Emitted before the status string. */
  readonly onConnectionState?: ConnectionStateHandler;
  /** Test seam. Production leaves this unset and a real `ws` socket is used. */
  readonly createSocket?: () => WebSocket;
  readonly now?: () => number;
}

export class UpbitWebSocketClient {
  private socket?: WebSocket;
  /** The ONE reconnect timer this client may own. Its liveness is mirrored to the supervisor. */
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopped = true;
  private markets: string[];
  private health: UpbitStreamHealth = "DISCONNECTED";
  private lastMessageAt?: number;
  private readonly latestTickers = new Map<string, UpbitTicker>();
  private readonly lastTradeTimestamp = new Map<string, number>();
  private readonly supervisor: MarketConnectionSupervisor;
  private readonly policy: MarketReconnectPolicy;
  private readonly onConnectionState?: ConnectionStateHandler;
  private readonly createSocket: () => WebSocket;
  private readonly now: () => number;

  constructor(
    market: string | readonly string[],
    private readonly onTicker: TickerHandler,
    private readonly onStatus: StatusHandler = () => undefined,
    maximumReconnectAttempts = DEFAULT_MARKET_RECONNECT_POLICY.maxAttempts,
    staleAfterMs = DEFAULT_MARKET_RECONNECT_POLICY.staleAfterMs,
    options: UpbitWebSocketOptions = {}
  ) {
    this.markets = normalizeUpbitMarkets(market);
    if (!Number.isSafeInteger(maximumReconnectAttempts) || maximumReconnectAttempts < 1) {
      throw new Error("maximumReconnectAttempts must be a positive safe integer");
    }
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1_000) {
      throw new Error("staleAfterMs must be an integer >= 1000");
    }
    // The positional arguments stay authoritative where they are given, so an existing caller
    // keeps the bounds it asked for; anything it did not specify comes from the shared policy.
    this.policy = Object.freeze({ ...DEFAULT_MARKET_RECONNECT_POLICY, ...options.policy, maxAttempts: maximumReconnectAttempts, staleAfterMs });
    this.now = options.now ?? (() => Date.now());
    this.onConnectionState = options.onConnectionState;
    this.createSocket = options.createSocket ?? (() => new WebSocket("wss://api.upbit.com/websocket/v1", {
      headers: { "User-Agent": "nusa-desktop/0.1" }
    }));
    this.supervisor = new MarketConnectionSupervisor({
      policy: this.policy,
      now: this.now,
      // One callback and one subscription, counted from the handles themselves rather than
      // asserted as constants, so a leaked socket would show up here instead of hiding.
      getListenerCount: () => (this.socket === undefined ? 0 : 1),
      getSubscriptionCount: () => (this.socket === undefined ? 0 : this.markets.length)
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.startHeartbeat();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.teardownSocket();
    this.supervisor.noteStopped();
    this.setHealth("DISCONNECTED", "stopped");
  }

  subscribe(markets: string | readonly string[]): void {
    this.markets = normalizeUpbitMarkets(markets);
    for (const market of [...this.latestTickers.keys()]) {
      if (!this.markets.includes(market)) {
        this.latestTickers.delete(market);
        this.lastTradeTimestamp.delete(market);
      }
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.sendSubscription();
  }

  currentHealth(): UpbitStreamHealth {
    return this.health;
  }

  /** Read-only. Never opens a connection or mutates state (WO-0034-A4L). */
  connectionDiagnostics(): MarketConnectionDiagnostics {
    return this.supervisor.diagnostics();
  }

  /**
   * Whether the feed is fresh, stale, or unmeasurable. Separate from the connection state:
   * a connected socket can be stale, and a reconnecting one is neither fresh nor stale --
   * its freshness is simply unknown until data flows again.
   */
  freshness(latestCandleCloseTime: number | null = null) {
    return evaluateMarketFreshness({
      now: this.now(),
      lastMessageAt: this.lastMessageAt ?? null,
      latestCandleCloseTime,
      toleranceMs: this.policy.staleAfterMs
    });
  }

  snapshot(now = this.now()): UpbitMarketSnapshot {
    return Object.freeze({
      generatedAt: now,
      tickers: Object.freeze([...this.latestTickers.values()].map((ticker) => Object.freeze({ ...ticker })))
    });
  }

  private setHealth(health: UpbitStreamHealth, status: string): void {
    this.health = health;
    // Structured state first: a consumer that acts on both must see the specific reason
    // (MARKET_RECONNECT_TIMEOUT) before the generic status string it superseded.
    this.onConnectionState?.(this.supervisor.diagnostics());
    this.onStatus(status);
  }

  /**
   * Detaches and closes any socket this client still holds. Called before every connect and
   * on stop, so a reconnection can never leave the previous socket's listeners attached --
   * that is what would deliver each ticker twice and double the effective subscription count.
   */
  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.removeAllListeners();
    try { socket.close(); } catch { /* already closing; nothing left to release */ }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.supervisor.disarmReconnectTimer();
  }

  private connect(): void {
    if (this.stopped) return;
    // Any previous socket is released BEFORE a new one is created, not after it opens.
    this.teardownSocket();
    this.setHealth("CONNECTING", "connecting");
    const socket = this.createSocket();
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.lastMessageAt = this.now();
      this.supervisor.noteOpened();
      this.setHealth("CONNECTED", "connected");
      this.sendSubscription();
    });

    socket.on("message", (data) => {
      if (this.socket !== socket) return;
      try {
        const ticker = JSON.parse(data.toString()) as UpbitTicker;
        const previousTimestamp = this.lastTradeTimestamp.get(ticker.code);
        if (!shouldAcceptUpbitTicker(ticker, this.markets, previousTimestamp)) return;
        this.lastMessageAt = this.now();
        this.lastTradeTimestamp.set(ticker.code, ticker.trade_timestamp);
        this.latestTickers.set(ticker.code, Object.freeze({ ...ticker }));
        this.supervisor.noteMessage();
        if (this.health !== "CONNECTED") this.setHealth("CONNECTED", "connected");
        this.onTicker(ticker);
      } catch (error) {
        this.setHealth("DEGRADED", `decode-error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) return;
      this.setHealth("DEGRADED", `error: ${error.message}`);
    });
    socket.on("close", () => {
      // A close from a socket this client already replaced is the old connection finishing
      // its teardown. Acting on it would open a second reconnect episode for a socket that
      // is no longer in use.
      if (this.socket !== socket) return;
      // Release it here rather than merely dropping the reference: once `this.socket` is
      // null the next connect's teardown has nothing left to detach, and this socket's
      // listeners would survive the reconnection and deliver every ticker twice.
      this.teardownSocket();
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private sendSubscription(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify([
      { ticket: `nusa-${this.now()}` },
      { type: "ticker", codes: this.markets, isOnlyRealtime: true },
      { format: "DEFAULT" }
    ]));
  }

  /**
   * Releases the staleness heartbeat. Called on stop AND on give-up: a client that has
   * abandoned the feed has nothing left to judge the freshness of, and leaving the interval
   * running would keep one live timer in the process that no diagnostic counts.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /** Live timers this client owns: the staleness heartbeat plus any armed reconnect timer. */
  activeTimerCount(): number {
    return (this.heartbeatTimer === undefined ? 0 : 1) + this.supervisor.diagnostics().reconnectTimerCount;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = Math.max(1_000, Math.min(5_000, Math.floor(this.policy.staleAfterMs / 2)));
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.lastMessageAt || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const age = this.now() - this.lastMessageAt;
      if (age > this.policy.staleAfterMs && this.health !== "STALE") {
        this.supervisor.noteStale();
        this.setHealth("STALE", `stale-${age}ms`);
      }
    }, interval);
  }

  private scheduleReconnect(): void {
    // Exactly one timer. The supervisor throws if this client tries to arm a second, so a
    // duplicate is a loud failure rather than a silently doubled retry rate.
    this.clearReconnectTimer();
    const decision = this.supervisor.noteDisconnected();
    if (decision.action === "GIVE_UP") {
      this.stopped = true;
      this.stopHeartbeat();
      this.setHealth("DISCONNECTED", "reconnect-exhausted");
      return;
    }
    this.supervisor.armReconnectTimer();
    this.setHealth("CONNECTING", `reconnecting-in-${decision.delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.supervisor.disarmReconnectTimer();
      this.connect();
    }, decision.delayMs);
  }
}
