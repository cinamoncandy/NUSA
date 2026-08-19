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

export interface UpbitTrade {
  type: "trade";
  code: string;
  trade_price: number;
  trade_volume: number;
  ask_bid: "ASK" | "BID";
  trade_timestamp: number;
  sequential_id?: number;
}

export interface UpbitOrderBookUnit {
  ask_price: number;
  bid_price: number;
  ask_size: number;
  bid_size: number;
}

export interface UpbitOrderBook {
  type: "orderbook";
  code: string;
  total_ask_size: number;
  total_bid_size: number;
  orderbook_units: readonly UpbitOrderBookUnit[];
}

export type UpbitPublicMessage = UpbitTicker | UpbitTrade | UpbitOrderBook;
export type UpbitStreamHealth = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE" | "DEGRADED";
export type TickerHandler = (ticker: UpbitTicker) => void;
export type TradeHandler = (trade: UpbitTrade) => void;
export type OrderBookHandler = (orderBook: UpbitOrderBook) => void;
export type StatusHandler = (status: string) => void;
/** Structured counterpart to StatusHandler. Carries state, never a string to be re-parsed. */
export type ConnectionStateHandler = (diagnostics: MarketConnectionDiagnostics) => void;

export interface UpbitMarketSnapshot {
  readonly generatedAt: number;
  readonly tickers: readonly UpbitTicker[];
}

export interface UpbitSocket {
  readonly readyState: number;
  on(event: string, listener: (...args: any[]) => void): UpbitSocket;
  removeAllListeners(): UpbitSocket;
  send(data: string): void;
  close(): void;
  ping?(): void;
}

export interface UpbitWebSocketTransport {
  createSocket(): UpbitSocket;
}

export const UPBIT_WEBSOCKET_OPEN = 1;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} is invalid`);
  return value;
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} is invalid`);
  return value;
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${field} is invalid`);
  return value as number;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Upbit public message must be an object");
  return value as Record<string, unknown>;
}

function optionalFinite(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} is invalid`);
  return value;
}

function parseTicker(value: Record<string, unknown>): UpbitTicker {
  const signedChangeRate = optionalFinite(value.signed_change_rate, "ticker signed_change_rate");
  const accumulatedVolume = value.acc_trade_volume === undefined ? undefined : nonNegativeNumber(value.acc_trade_volume, "ticker acc_trade_volume");
  const accumulatedPrice = value.acc_trade_price_24h === undefined ? undefined : nonNegativeNumber(value.acc_trade_price_24h, "ticker acc_trade_price_24h");
  return Object.freeze({
    type: "ticker" as const,
    code: requiredString(value.code, "ticker code"),
    trade_price: positiveNumber(value.trade_price, "ticker trade_price"),
    trade_timestamp: timestamp(value.trade_timestamp, "ticker trade_timestamp"),
    ...(signedChangeRate === undefined ? {} : { signed_change_rate: signedChangeRate }),
    ...(accumulatedVolume === undefined ? {} : { acc_trade_volume: accumulatedVolume }),
    ...(accumulatedPrice === undefined ? {} : { acc_trade_price_24h: accumulatedPrice })
  });
}

function parseTrade(value: Record<string, unknown>): UpbitTrade {
  const askBid = value.ask_bid;
  if (askBid !== "ASK" && askBid !== "BID") throw new Error("trade ask_bid is invalid");
  // NOT a timestamp. Upbit's sequential_id is an opaque monotonic trade id whose live values
  // (~1.79e16) sit well above Number.MAX_SAFE_INTEGER, so validating it as a timestamp rejected
  // every real trade message. Each rejection marked the whole feed DEGRADED, which cleared the
  // accumulated ticker intelligence and pinned the PAPER kill switch closed -- the public feed
  // could never reach a tradable state. Accept any positive finite number instead.
  //
  // JSON.parse has already rounded this value before we see it, so it is informational only and
  // must never be used for ordering, dedup, or identity. Nothing reads it today.
  const sequentialId = value.sequential_id === undefined ? undefined : positiveNumber(value.sequential_id, "trade sequential_id");
  return Object.freeze({
    type: "trade" as const,
    code: requiredString(value.code, "trade code"),
    trade_price: positiveNumber(value.trade_price, "trade trade_price"),
    trade_volume: positiveNumber(value.trade_volume, "trade trade_volume"),
    ask_bid: askBid,
    trade_timestamp: timestamp(value.trade_timestamp, "trade trade_timestamp"),
    ...(sequentialId === undefined ? {} : { sequential_id: sequentialId })
  });
}

function parseOrderBook(value: Record<string, unknown>): UpbitOrderBook {
  if (!Array.isArray(value.orderbook_units) || value.orderbook_units.length === 0) throw new Error("orderbook orderbook_units is required");
  const units = value.orderbook_units.map((raw, index) => {
    const unit = recordValue(raw);
    return Object.freeze({
      ask_price: positiveNumber(unit.ask_price, `orderbook_units[${index}].ask_price`),
      bid_price: positiveNumber(unit.bid_price, `orderbook_units[${index}].bid_price`),
      ask_size: nonNegativeNumber(unit.ask_size, `orderbook_units[${index}].ask_size`),
      bid_size: nonNegativeNumber(unit.bid_size, `orderbook_units[${index}].bid_size`)
    });
  });
  return Object.freeze({
    type: "orderbook" as const,
    code: requiredString(value.code, "orderbook code"),
    total_ask_size: nonNegativeNumber(value.total_ask_size, "orderbook total_ask_size"),
    total_bid_size: nonNegativeNumber(value.total_bid_size, "orderbook total_bid_size"),
    orderbook_units: Object.freeze(units)
  });
}

/** Parses only Upbit public channel payloads. Private and unknown channels fail closed. */
export function parseUpbitPublicMessage(data: string | Uint8Array): UpbitPublicMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
  } catch {
    throw new Error("Upbit public message is not valid JSON");
  }
  const value = recordValue(parsed);
  switch (value.type) {
    case "ticker": return parseTicker(value);
    case "trade": return parseTrade(value);
    case "orderbook": return parseOrderBook(value);
    default: throw new Error("unsupported Upbit WebSocket channel");
  }
}

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
  readonly createSocket?: () => UpbitSocket;
  readonly transport?: UpbitWebSocketTransport;
  readonly onTrade?: TradeHandler;
  readonly onOrderBook?: OrderBookHandler;
  readonly now?: () => number;
}

export class UpbitWebSocketClient {
  private socket?: UpbitSocket;
  /** The ONE reconnect timer this client may own. Its liveness is mirrored to the supervisor. */
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopped = true;
  private markets: string[];
  private health: UpbitStreamHealth = "DISCONNECTED";
  private lastMessageAt?: number;
  private lastPongAt?: number;
  private readonly latestTickers = new Map<string, UpbitTicker>();
  private readonly lastTradeTimestamp = new Map<string, number>();
  private readonly supervisor: MarketConnectionSupervisor;
  private readonly policy: MarketReconnectPolicy;
  private readonly onConnectionState?: ConnectionStateHandler;
  private readonly onTrade?: TradeHandler;
  private readonly onOrderBook?: OrderBookHandler;
  private readonly createSocket: () => UpbitSocket;
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
    this.policy = Object.freeze({ ...DEFAULT_MARKET_RECONNECT_POLICY, ...options.policy, maxAttempts: maximumReconnectAttempts, staleAfterMs });
    this.now = options.now ?? (() => Date.now());
    this.onConnectionState = options.onConnectionState;
    this.onTrade = options.onTrade;
    this.onOrderBook = options.onOrderBook;
    this.createSocket = options.createSocket
      ?? options.transport?.createSocket.bind(options.transport)
      ?? (() => new WebSocket("wss://api.upbit.com/websocket/v1", {
        headers: { "User-Agent": "nusa-desktop/0.1" }
      }) as UpbitSocket);
    this.supervisor = new MarketConnectionSupervisor({
      policy: this.policy,
      now: this.now,
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
    if (this.socket?.readyState === UPBIT_WEBSOCKET_OPEN) this.sendSubscription();
  }

  unsubscribe(markets: string | readonly string[]): void {
    const remove = new Set(normalizeUpbitMarkets(markets));
    const remaining = this.markets.filter((market) => !remove.has(market));
    if (remaining.length === 0) throw new Error("at least one Upbit market must remain subscribed");
    this.markets = remaining;
    for (const market of remove) {
      this.latestTickers.delete(market);
      this.lastTradeTimestamp.delete(market);
    }
    if (this.socket?.readyState === UPBIT_WEBSOCKET_OPEN) this.sendSubscription();
  }

  currentHealth(): UpbitStreamHealth { return this.health; }

  connectionDiagnostics(): MarketConnectionDiagnostics { return this.supervisor.diagnostics(); }

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

  lastPongTimestamp(): number | undefined { return this.lastPongAt; }

  private setHealth(health: UpbitStreamHealth, status: string): void {
    this.health = health;
    this.onConnectionState?.(this.supervisor.diagnostics());
    this.onStatus(status);
  }

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

    socket.on("pong", () => { this.lastPongAt = this.now(); });
    socket.on("message", (data) => {
      if (this.socket !== socket) return;
      try {
        const message = parseUpbitPublicMessage(typeof data === "string" ? data : data instanceof Uint8Array ? data : String(data));
        if (!this.markets.includes(message.code)) return;
        if (message.type === "ticker") {
          const previousTimestamp = this.lastTradeTimestamp.get(message.code);
          if (!shouldAcceptUpbitTicker(message, this.markets, previousTimestamp)) return;
          this.lastTradeTimestamp.set(message.code, message.trade_timestamp);
          this.latestTickers.set(message.code, message);
        }
        this.lastMessageAt = this.now();
        this.supervisor.noteMessage();
        if (this.health !== "CONNECTED") this.setHealth("CONNECTED", "connected");
        if (message.type === "ticker") this.onTicker(message);
        if (message.type === "trade") this.onTrade?.(message);
        if (message.type === "orderbook") this.onOrderBook?.(message);
      } catch (error) {
        this.setHealth("DEGRADED", `decode-error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) return;
      this.setHealth("DEGRADED", `error: ${error.message}`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.teardownSocket();
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private sendSubscription(): void {
    if (!this.socket || this.socket.readyState !== UPBIT_WEBSOCKET_OPEN) return;
    this.socket.send(JSON.stringify([
      { ticket: `nusa-${this.now()}` },
      { type: "ticker", codes: this.markets, isOnlyRealtime: true },
      { type: "trade", codes: this.markets, isOnlyRealtime: true },
      { type: "orderbook", codes: this.markets, isOnlyRealtime: true },
      { format: "DEFAULT" }
    ]));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  activeTimerCount(): number {
    return (this.heartbeatTimer === undefined ? 0 : 1) + this.supervisor.diagnostics().reconnectTimerCount;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = Math.max(1_000, Math.min(5_000, Math.floor(this.policy.staleAfterMs / 2)));
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.socket || this.socket.readyState !== UPBIT_WEBSOCKET_OPEN) return;
      this.socket.ping?.();
      if (!this.lastMessageAt) return;
      const age = this.now() - this.lastMessageAt;
      if (age > this.policy.staleAfterMs && this.health !== "STALE") {
        this.supervisor.noteStale();
        this.setHealth("STALE", `stale-${age}ms`);
      }
    }, interval);
  }

  private scheduleReconnect(): void {
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

export class MockUpbitWebSocket implements UpbitSocket {
  public readyState = 0;
  public closed = false;
  public pingCount = 0;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): UpbitSocket {
    const listeners = this.listeners.get(event) ?? new Set<(...args: any[]) => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeAllListeners(): UpbitSocket {
    this.listeners.clear();
    return this;
  }

  send(data: string): void { this.sent.push(data); }
  ping(): void { this.pingCount += 1; }
  open(): void { this.readyState = UPBIT_WEBSOCKET_OPEN; this.emit("open"); }
  emitMessage(data: string): void { this.emit("message", data); }
  emitPong(): void { this.emit("pong"); }
  emitError(error: Error): void { this.emit("error", error); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }

  private emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

export class MockUpbitWebSocketTransport implements UpbitWebSocketTransport {
  public readonly sockets: MockUpbitWebSocket[] = [];

  createSocket(): UpbitSocket {
    const socket = new MockUpbitWebSocket();
    this.sockets.push(socket);
    return socket;
  }
}
