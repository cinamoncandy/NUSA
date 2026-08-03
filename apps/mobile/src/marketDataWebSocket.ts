export interface Ticker {
  readonly market: string;
  readonly lastPrice: number;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly timestampMs: number;
}

export interface MarketSocket {
  send(message: string): void;
  ping?(): void;
  close(): void;
}

export interface MarketSocketHandlers {
  readonly open: () => void;
  readonly message: (payload: string) => void;
  readonly close: () => void;
}

export interface MarketSocketTransport {
  connect(url: string, handlers: MarketSocketHandlers): Promise<MarketSocket>;
}

export interface MarketDataOptions {
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly heartbeatMs?: number;
}

export type MarketDataStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "CLOSED";

const positive = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const bounded = (value: number, field: string): number => {
  positive(value, field);
  return value;
};

const parseTicker = (payload: string): Ticker => {
  let value: unknown;
  try { value = JSON.parse(payload); } catch { throw new Error("market message is not valid JSON"); }
  if (!value || typeof value !== "object") throw new Error("market message must be an object");
  const item = value as Record<string, unknown>;
  if (typeof item.market !== "string" || !item.market.trim()) throw new Error("ticker market is required");
  for (const field of ["lastPrice", "bidPrice", "askPrice", "timestampMs"]) if (typeof item[field] !== "number" || !Number.isFinite(item[field])) throw new Error(`ticker ${field} is invalid`);
  return Object.freeze({ market: item.market, lastPrice: item.lastPrice as number, bidPrice: item.bidPrice as number, askPrice: item.askPrice as number, timestampMs: item.timestampMs as number });
};

export class MarketDataWebSocketClient {
  private socket: MarketSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private readonly markets = new Set<string>();
  private _status: MarketDataStatus = "DISCONNECTED";

  public constructor(
    private readonly url: string,
    private readonly transport: MarketSocketTransport,
    private readonly onTicker: (ticker: Ticker) => void,
    options: MarketDataOptions = {},
  ) {
    if (!url.trim()) throw new Error("url must not be empty");
    const base = options.reconnectBaseMs ?? 250;
    const max = options.reconnectMaxMs ?? 10_000;
    this.reconnectBaseMs = bounded(base, "reconnectBaseMs");
    this.reconnectMaxMs = bounded(max, "reconnectMaxMs");
    if (this.reconnectMaxMs < this.reconnectBaseMs) throw new Error("reconnectMaxMs must be >= reconnectBaseMs");
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.heartbeatMs = bounded(options.heartbeatMs ?? 15_000, "heartbeatMs");
    if (!Number.isSafeInteger(this.maxReconnectAttempts) || this.maxReconnectAttempts < 0) throw new Error("maxReconnectAttempts must be non-negative");
  }

  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatMs: number;

  public get status(): MarketDataStatus { return this._status; }
  public get subscriptionCount(): number { return this.markets.size; }
  public nextReconnectDelayMs(): number { return Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** this.reconnectAttempts)); }

  public async connect(): Promise<void> {
    if (this.socket || this._status === "CONNECTING" || this._status === "CONNECTED") return;
    this.stopped = false;
    this._status = this.reconnectAttempts === 0 ? "CONNECTING" : "RECONNECTING";
    try {
      this.socket = await this.transport.connect(this.url, { open: () => this.handleOpen(), message: (payload) => this.handleMessage(payload), close: () => this.handleClose() });
      this.handleOpen();
    } catch {
      this.socket = null;
      this.handleClose();
    }
  }

  public disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this._status = "CLOSED";
  }

  public subscribe(market: string): void {
    const value = market.trim();
    if (!value) throw new Error("market must not be empty");
    if (this.markets.has(value)) return;
    this.markets.add(value);
    if (this.socket && this._status === "CONNECTED") this.sendSubscription(value);
  }

  public unsubscribe(market: string): void {
    const value = market.trim();
    if (!this.markets.delete(value)) return;
    if (this.socket && this._status === "CONNECTED") this.socket.send(JSON.stringify({ type: "unsubscribe", market: value }));
  }

  private handleOpen(): void {
    if (this.stopped) return;
    this._status = "CONNECTED";
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    for (const market of this.markets) this.sendSubscription(market);
    this.heartbeatTimer ??= setInterval(() => this.socket?.ping?.(), this.heartbeatMs);
  }

  private handleMessage(payload: string): void { this.onTicker(parseTicker(payload)); }

  private handleClose(): void {
    this.socket = null;
    this.clearHeartbeatTimer();
    if (this.stopped) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) { this._status = "DISCONNECTED"; return; }
    this._status = "RECONNECTING";
    const delay = this.nextReconnectDelayMs();
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, delay);
  }

  private sendSubscription(market: string): void { this.socket?.send(JSON.stringify({ type: "subscribe", market })); }
  private clearReconnectTimer(): void { if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }
  private clearHeartbeatTimer(): void { if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; } }
  private clearTimers(): void { this.clearReconnectTimer(); this.clearHeartbeatTimer(); }
}

export class MockWebSocketTransport implements MarketSocketTransport {
  public readonly sent: string[] = [];
  public readonly sockets: MockMarketSocket[] = [];

  public async connect(_url: string, handlers: MarketSocketHandlers): Promise<MarketSocket> {
    const socket = new MockMarketSocket(handlers, this.sent);
    this.sockets.push(socket);
    return socket;
  }
}

export class MockMarketSocket implements MarketSocket {
  public pingCount = 0;
  public closed = false;
  public constructor(private readonly handlers: MarketSocketHandlers, private readonly sent: string[]) {}
  public open(): void { this.handlers.open(); }
  public send(message: string): void { this.sent.push(message); }
  public ping(): void { this.pingCount += 1; }
  public emit(payload: string): void { this.handlers.message(payload); }
  public close(): void { if (!this.closed) { this.closed = true; this.handlers.close(); } }
}
