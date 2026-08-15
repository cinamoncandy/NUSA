import { parseUpbitTickerRow } from "./upbitPublicQuotationClient";
import type { WatchlistMarket } from "./watchlist";

/**
 * Real-time counterpart to upbitPublicQuotationClient.ts's REST polling: connects directly to
 * Upbit's public ticker WebSocket feed (no API key required -- same "public" trust tier as the
 * REST ticker/candle endpoints) and pushes ticks as they happen instead of waiting for the next
 * 30s poll. This is additive, not a replacement: callers keep the existing REST refresh as the
 * baseline/fallback and merge these ticks on top, so a socket outage degrades to the pre-existing
 * polling behavior rather than losing data.
 */
export const UPBIT_PUBLIC_WEBSOCKET_URL = "wss://api.upbit.com/websocket/v1";

export type UpbitWebSocketStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "CLOSED";

export interface UpbitSocketHandle {
  send(data: string): void;
  close(): void;
}

export interface UpbitSocketHandlers {
  readonly message: (data: string) => void;
  readonly close: () => void;
}

/** Abstraction over the raw socket so tests can substitute a mock instead of a real WebSocket.
 * connect() resolves once the socket is genuinely open (not merely constructed) -- callers must
 * not send before then, since sending on a real WebSocket that hasn't finished its handshake
 * throws. Rejects if the connection attempt itself fails before ever opening. */
export interface UpbitWebSocketTransport {
  connect(url: string, handlers: UpbitSocketHandlers): Promise<UpbitSocketHandle>;
}

/** Default transport: the platform global `WebSocket` (present in React Native and browsers). */
export class GlobalWebSocketTransport implements UpbitWebSocketTransport {
  public connect(url: string, handlers: UpbitSocketHandlers): Promise<UpbitSocketHandle> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let opened = false;
      socket.onopen = () => { opened = true; resolve({ send: (data) => socket.send(data), close: () => socket.close() }); };
      socket.onmessage = (event) => handlers.message(typeof event.data === "string" ? event.data : String(event.data));
      socket.onclose = () => handlers.close();
      // Only the pre-open failure is this promise's problem; a post-open error is always
      // followed by onclose, which drives reconnect on its own.
      socket.onerror = () => { if (!opened) reject(new Error("Upbit WebSocket connection failed.")); };
    });
  }
}

export interface UpbitPublicWebSocketOptions {
  readonly url?: string;
  readonly transport?: UpbitWebSocketTransport;
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  /** Upbit has no ping/pong requirement, but connections it considers idle are cut server-side;
   * a periodic no-op keeps the socket alive without changing the subscription. */
  readonly heartbeatMs?: number;
  /** Injectable so tests get deterministic ticket ids instead of asserting on randomness. */
  readonly ticketFactory?: () => string;
}

const positiveMs = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

function defaultTicket(): string {
  return `nusa-mobile-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Builds Upbit's required subscribe frame. Upbit has no incremental subscribe/unsubscribe --
 * each connection is told its *entire* desired code list in one array, replacing whatever it
 * was told before, so callers always pass the full current market set here.
 */
export function buildUpbitSubscribeFrame(markets: readonly string[], ticket: string): string {
  return JSON.stringify([{ ticket }, { type: "ticker", codes: [...markets] }, { format: "DEFAULT" }]);
}

/** Parses one DEFAULT-format ticker push. Returns null for non-ticker frames (this client never
 * subscribes to anything but `ticker`, but a defensive check keeps it forward-compatible instead
 * of throwing on the unexpected, e.g. a "PONG" keepalive reply). */
export function parseUpbitWebSocketTicker(payload: string): WatchlistMarket | null {
  let value: unknown;
  try { value = JSON.parse(payload); } catch { throw new Error("Upbit WebSocket message is not valid JSON."); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Upbit WebSocket message is invalid.");
  const row = value as Record<string, unknown>;
  if (row.type !== "ticker") return null;
  return parseUpbitTickerRow(row, "code");
}

export class UpbitPublicWebSocketClient {
  private handle: UpbitSocketHandle | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private reconnectAttempts = 0;
  private markets: readonly string[] = [];
  private _status: UpbitWebSocketStatus = "DISCONNECTED";

  private readonly url: string;
  private readonly transport: UpbitWebSocketTransport;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly heartbeatMs: number;
  private readonly ticketFactory: () => string;

  public constructor(private readonly onTicker: (ticker: WatchlistMarket) => void, options: UpbitPublicWebSocketOptions = {}) {
    this.url = options.url ?? UPBIT_PUBLIC_WEBSOCKET_URL;
    this.transport = options.transport ?? new GlobalWebSocketTransport();
    this.reconnectBaseMs = positiveMs(options.reconnectBaseMs ?? 500, "reconnectBaseMs");
    this.reconnectMaxMs = positiveMs(options.reconnectMaxMs ?? 30_000, "reconnectMaxMs");
    if (this.reconnectMaxMs < this.reconnectBaseMs) throw new Error("reconnectMaxMs must be >= reconnectBaseMs");
    this.heartbeatMs = positiveMs(options.heartbeatMs ?? 60_000, "heartbeatMs");
    this.ticketFactory = options.ticketFactory ?? defaultTicket;
  }

  public get status(): UpbitWebSocketStatus { return this._status; }
  public get subscribedMarkets(): readonly string[] { return this.markets; }
  public nextReconnectDelayMs(): number { return Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** this.reconnectAttempts)); }

  public async connect(): Promise<void> {
    if (this.handle || this._status === "CONNECTING") return;
    this.stopped = false;
    this._status = this.reconnectAttempts === 0 ? "CONNECTING" : "RECONNECTING";
    try {
      this.handle = await this.transport.connect(this.url, { message: (payload) => this.handleMessage(payload), close: () => this.handleClose() });
      this.handleOpen();
    } catch {
      this.handle = null;
      this.handleClose();
    }
  }

  public disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    this.handle?.close();
    this.handle = null;
    this._status = "CLOSED";
  }

  /** Replaces the full subscribed market set. If connected, resends the subscribe frame
   * immediately; otherwise the new set takes effect on the next (re)connect. */
  public setMarkets(markets: readonly string[]): void {
    this.markets = Object.freeze([...new Set(markets)]);
    if (this.handle && this._status === "CONNECTED") this.sendSubscription();
  }

  private handleOpen(): void {
    if (this.stopped) { this.handle?.close(); this.handle = null; return; }
    this._status = "CONNECTED";
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    if (this.markets.length > 0) this.sendSubscription();
    // Upbit drops a connection after 120s of silence; a bare "PING" text frame (documented
    // keepalive, answered with "PONG") resets that timer without touching the subscription.
    this.heartbeatTimer ??= setInterval(() => { try { this.handle?.send("PING"); } catch { /* dropped frame surfaces via close/reconnect, not here */ } }, this.heartbeatMs);
  }

  private handleMessage(payload: string): void {
    let ticker: WatchlistMarket | null;
    try { ticker = parseUpbitWebSocketTicker(payload); } catch { return; }
    if (ticker) this.onTicker(ticker);
  }

  private handleClose(): void {
    this.handle = null;
    this.clearHeartbeatTimer();
    if (this.stopped) return;
    this._status = "RECONNECTING";
    const delay = this.nextReconnectDelayMs();
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, delay);
  }

  private sendSubscription(): void { try { this.handle?.send(buildUpbitSubscribeFrame(this.markets, this.ticketFactory())); } catch { /* dropped frame surfaces via close/reconnect, not here */ } }
  private clearReconnectTimer(): void { if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }
  private clearHeartbeatTimer(): void { if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; } }
  private clearTimers(): void { this.clearReconnectTimer(); this.clearHeartbeatTimer(); }
}

export class MockUpbitWebSocketTransport implements UpbitWebSocketTransport {
  public readonly sent: string[] = [];
  public readonly sockets: MockUpbitSocket[] = [];
  public async connect(_url: string, handlers: UpbitSocketHandlers): Promise<UpbitSocketHandle> {
    const socket = new MockUpbitSocket(handlers, this.sent);
    this.sockets.push(socket);
    return socket;
  }
}

export class MockUpbitSocket implements UpbitSocketHandle {
  public closed = false;
  public constructor(private readonly handlers: UpbitSocketHandlers, private readonly sent: string[]) {}
  public send(data: string): void { this.sent.push(data); }
  public emit(payload: string): void { this.handlers.message(payload); }
  public close(): void { if (!this.closed) { this.closed = true; this.handlers.close(); } }
}
