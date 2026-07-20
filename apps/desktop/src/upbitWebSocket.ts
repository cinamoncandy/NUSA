import WebSocket from "ws";

export interface UpbitTicker {
  type: "ticker";
  code: string;
  trade_price: number;
  trade_timestamp: number;
  signed_change_rate?: number;
  acc_trade_price_24h?: number;
}

export interface UpbitMarketSnapshot {
  readonly generatedAt: number;
  readonly tickers: readonly UpbitTicker[];
}

export type UpbitStreamHealth = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE" | "DEGRADED";
export type TickerHandler = (ticker: UpbitTicker) => void;
export type StatusHandler = (status: string) => void;

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

export class UpbitWebSocketClient {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopped = true;
  private reconnectAttempt = 0;
  private markets: string[];
  private health: UpbitStreamHealth = "DISCONNECTED";
  private lastMessageAt?: number;
  private readonly latestTickers = new Map<string, UpbitTicker>();
  private readonly lastTradeTimestamp = new Map<string, number>();

  constructor(
    market: string | readonly string[],
    private readonly onTicker: TickerHandler,
    private readonly onStatus: StatusHandler = () => undefined,
    private readonly maximumReconnectAttempts = 8,
    private readonly staleAfterMs = 30_000
  ) {
    this.markets = normalizeUpbitMarkets(market);
    if (!Number.isSafeInteger(maximumReconnectAttempts) || maximumReconnectAttempts < 1) {
      throw new Error("maximumReconnectAttempts must be a positive safe integer");
    }
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1_000) {
      throw new Error("staleAfterMs must be an integer >= 1000");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.startHeartbeat();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = undefined;
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

  snapshot(now = Date.now()): UpbitMarketSnapshot {
    return Object.freeze({
      generatedAt: now,
      tickers: Object.freeze([...this.latestTickers.values()].map((ticker) => Object.freeze({ ...ticker })))
    });
  }

  private setHealth(health: UpbitStreamHealth, status: string): void {
    this.health = health;
    this.onStatus(status);
  }

  private connect(): void {
    if (this.stopped) return;
    this.setHealth("CONNECTING", "connecting");
    const socket = new WebSocket("wss://api.upbit.com/websocket/v1", {
      headers: { "User-Agent": "dokkaebi-desktop/0.1" }
    });
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.setHealth("CONNECTED", "connected");
      this.sendSubscription();
    });

    socket.on("message", (data) => {
      try {
        const ticker = JSON.parse(data.toString()) as UpbitTicker;
        const previousTimestamp = this.lastTradeTimestamp.get(ticker.code);
        if (!shouldAcceptUpbitTicker(ticker, this.markets, previousTimestamp)) return;
        this.lastMessageAt = Date.now();
        this.lastTradeTimestamp.set(ticker.code, ticker.trade_timestamp);
        this.latestTickers.set(ticker.code, Object.freeze({ ...ticker }));
        if (this.health !== "CONNECTED") this.setHealth("CONNECTED", "connected");
        this.onTicker(ticker);
      } catch (error) {
        this.setHealth("DEGRADED", `decode-error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    socket.on("error", (error) => this.setHealth("DEGRADED", `error: ${error.message}`));
    socket.on("close", () => {
      this.socket = undefined;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private sendSubscription(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify([
      { ticket: `dokkaebi-${Date.now()}` },
      { type: "ticker", codes: this.markets, isOnlyRealtime: true },
      { format: "DEFAULT" }
    ]));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const interval = Math.max(1_000, Math.min(5_000, Math.floor(this.staleAfterMs / 2)));
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.lastMessageAt || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const age = Date.now() - this.lastMessageAt;
      if (age > this.staleAfterMs && this.health !== "STALE") this.setHealth("STALE", `stale-${age}ms`);
    }, interval);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.maximumReconnectAttempts) {
      this.stopped = true;
      this.setHealth("DISCONNECTED", "reconnect-exhausted");
      return;
    }
    const delay = upbitReconnectDelay(this.reconnectAttempt);
    this.setHealth("CONNECTING", `reconnecting-in-${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
