import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  handleMobileDashboardHttp,
  type DashboardHttpRequest,
  type DashboardTokenVerifier,
  type MobileDashboardHttpDependencies
} from "./mobileDashboardHttp";
import {
  handlePersonalPaperOperationsHttp,
  type PersonalPaperOperationsHttpDependencies
} from "./personalPaperOperationsHttp";

export interface CloudDashboardServerOptions {
  readonly port: number;
  /** Defaults to "127.0.0.1". Binding beyond localhost is a deliberate, separate decision. */
  readonly host?: string;
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: MobileDashboardHttpDependencies["loadDashboard"];
  readonly loadPaperOperations?: PersonalPaperOperationsHttpDependencies["loadSnapshot"];
}

export interface CloudDashboardServerHandle {
  readonly port: number;
  readonly host: string;
  stop(): Promise<void>;
}

/**
 * Localhost-by-default read-only dashboard transport. `/api/paper-operations` and the legacy
 * dashboard projection share the same GET-only Bearer + `dashboard:read` authorization boundary.
 * No token issuer, mutation route, LIVE authority, or permissive fallback is provided here.
 */
export function startCloudDashboardServer(options: CloudDashboardServerOptions): CloudDashboardServerHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error("invalid cloud dashboard server port");
  }
  const host = options.host ?? "127.0.0.1";

  const server: Server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, observedAt: new Date().toISOString() }));
        return;
      }

      const dashboardRequest: DashboardHttpRequest = Object.freeze({
        method: req.method ?? "GET",
        headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>)
      });

      const result = req.url === "/api/paper-operations"
        ? handlePersonalPaperOperationsHttp(dashboardRequest, {
            tokenVerifier: options.tokenVerifier,
            loadSnapshot: options.loadPaperOperations ?? (() => { throw new Error("PAPER operations snapshot not configured"); })
          })
        : handleMobileDashboardHttp(dashboardRequest, {
            tokenVerifier: options.tokenVerifier,
            loadDashboard: options.loadDashboard
          });

      res.writeHead(result.status, result.headers as Record<string, string>);
      res.end(result.body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "DASHBOARD_SERVER_UNAVAILABLE" }));
      } else {
        res.destroy();
      }
    }
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("error", () => { /* a request-handling fault must not crash the process */ });
  server.listen(options.port, host);

  let stopping: Promise<void> | undefined;
  return {
    port: options.port,
    host,
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopping = new Promise((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return stopping;
    }
  };
}
