import WebSocket from "ws";

export interface UpbitTicker {
  type: "ticker";
  code: string;
  trade_price: number;
  trade_timestamp: number;
  signed_change_rate?: number;
  acc_trade_price_24h?: number;
}

export type TickerHandler = (ticker: UpbitTicker) => void;
export type StatusHandler = (status: string) => void;

export class UpbitWebSocketClient {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = true;
  private reconnectAttempt = 0;

  constructor(
    private readonly market: string,
    private readonly onTicker: TickerHandler,
    private readonly onStatus: StatusHandler = () => undefined,
    private readonly maximumReconnectAttempts = 8
  ) { if (!Number.isSafeInteger(maximumReconnectAttempts) || maximumReconnectAttempts < 1) throw new Error("maximumReconnectAttempts must be a positive safe integer"); }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = undefined;
    this.onStatus("stopped");
  }

  private connect(): void {
    if (this.stopped) return;
    this.onStatus("connecting");
    const socket = new WebSocket("wss://api.upbit.com/websocket/v1", {
      headers: { "User-Agent": "dokkaebi-desktop/0.1" }
    });
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.onStatus("connected");
      socket.send(JSON.stringify([
        { ticket: `dokkaebi-${Date.now()}` },
        { type: "ticker", codes: [this.market], isOnlyRealtime: true },
        { format: "DEFAULT" }
      ]));
    });

    socket.on("message", (data) => {
      try {
        const ticker = JSON.parse(data.toString()) as UpbitTicker;
        if (ticker.type === "ticker" && ticker.code === this.market && Number.isFinite(ticker.trade_price)) {
          this.onTicker(ticker);
        }
      } catch (error) {
        this.onStatus(`decode-error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    socket.on("error", (error) => this.onStatus(`error: ${error.message}`));
    socket.on("close", () => {
      this.socket = undefined;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.maximumReconnectAttempts) {
      this.stopped = true;
      this.onStatus("reconnect-exhausted");
      return;
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt - 1, 5));
    this.onStatus(`reconnecting-in-${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
