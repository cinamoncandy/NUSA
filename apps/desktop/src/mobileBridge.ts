import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  parseMonitorAccountResponse,
  parseMonitorCandlesResponse,
  parseMonitorMarketStatusResponse,
  parseMonitorMarketsResponse,
  parseMonitorStatusResponse,
  type MonitorAccount,
  type MonitorCandle,
  type MonitorMarket,
  type MonitorStatus
} from "../../../packages/contracts/src/monitorRead";

export interface MobileBridgeOptions { readonly port: number; readonly getStatus: () => MonitorStatus; readonly getAccount: () => MonitorAccount; readonly getOpenOrderCount: () => number; readonly getEvents: () => readonly Readonly<Record<string, unknown>>[]; readonly getMarkets?: () => readonly MonitorMarket[]; readonly getCandles?: (market: string, interval: string, count: number) => readonly MonitorCandle[]; }
export interface MobileBridgeHandle { readonly port: number; stop(): Promise<void>; }

function send(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
function requestUrl(req: IncomingMessage): URL | null { try { return new URL(req.url ?? "/", "http://127.0.0.1"); } catch { return null; } }

/** Localhost-only, GET-only monitor. It has no control or credential surface. */
export function startMobileBridge(options: MobileBridgeOptions): MobileBridgeHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("invalid mobile monitor port");
  let stopping: Promise<void> | undefined;
  const server: Server = http.createServer((req, res) => {
    try {
      if (req.method !== "GET") { send(res, 405, { error: "read-only monitor" }); return; }
      const url = requestUrl(req); const path = url?.pathname ?? ""; const status = parseMonitorStatusResponse(options.getStatus());
      if (path === "/health") return send(res, 200, { ok: true, observedAt: status.observedAt });
      if (path === "/api/status") return send(res, 200, status);
      if (path === "/api/account") return send(res, 200, parseMonitorAccountResponse({ observedAt: status.observedAt, mode: status.mode, account: options.getAccount(), openOrderCount: options.getOpenOrderCount() }));
      if (path === "/api/market") return send(res, 200, parseMonitorMarketStatusResponse({ observedAt: status.observedAt, marketConnectionState: status.marketConnectionState, warmupState: status.warmupState, stale: status.stale }));
      if (path === "/api/markets") return send(res, 200, parseMonitorMarketsResponse({ observedAt: status.observedAt, markets: options.getMarkets?.() ?? [] }));
      if (path === "/api/candles") {
        const market = url?.searchParams.get("market") ?? "";
        const interval = url?.searchParams.get("interval") ?? "1m";
        const requestedCount = Number(url?.searchParams.get("count") ?? "120");
        const count = Number.isSafeInteger(requestedCount) ? Math.min(200, Math.max(1, requestedCount)) : 120;
        return send(res, 200, parseMonitorCandlesResponse({ observedAt: status.observedAt, market, interval, candles: options.getCandles?.(market, interval, count) ?? [] }));
      }
      if (path === "/api/events") return send(res, 200, { observedAt: status.observedAt, events: options.getEvents().slice(-20) });
      return send(res, 404, { error: "not found" });
    } catch {
      if (!res.headersSent) send(res, 503, { error: "monitor unavailable" });
      else res.destroy();
    }
  });
  server.on("error", () => { /* monitor failure must not take down the desktop app */ });
  server.listen(options.port, "127.0.0.1");
  return { port: options.port, stop(): Promise<void> { if (stopping) return stopping; stopping = new Promise((resolve) => { if (!server.listening) resolve(); else server.close(() => resolve()); }); return stopping; } };
}
