import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  handleMobileDashboardHttp,
  type DashboardHttpRequest,
  type DashboardTokenVerifier,
  type MobileDashboardHttpDependencies
} from "./mobileDashboardHttp";

export interface CloudDashboardServerOptions {
  readonly port: number;
  /** Defaults to "127.0.0.1". Binding beyond localhost is a deliberate, separate decision --
   * see the module doc comment below before changing this. */
  readonly host?: string;
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: MobileDashboardHttpDependencies["loadDashboard"];
}

export interface CloudDashboardServerHandle {
  readonly port: number;
  readonly host: string;
  stop(): Promise<void>;
}

/**
 * Binds `handleMobileDashboardHttp` -- an existing, already-tested pure request handler -- to an
 * actual port. That handler enforces GET-only, Bearer auth, and a `dashboard:read` scope; this
 * file's job is only transport, not policy.
 *
 * Deliberately out of scope here, because each is a separate decision with its own security
 * review, not something to fold into a transport shim:
 *
 * - **A real token issuer.** No `DashboardTokenVerifier` implementation exists anywhere in the
 *   repository yet -- only the interface. The caller must supply one. There is no default that
 *   accepts anything; the only safe default is to accept nothing.
 * - **Non-localhost binding.** `host` defaults to `127.0.0.1`. Serving mobile clients that are
 *   not on the same machine needs TLS, a real network boundary, and a decision about where this
 *   process runs -- none of which this file can decide.
 * - **CORS.** Not set. A browser-based client would need an explicit, non-wildcard origin list;
 *   none is configured because none is known to be needed yet.
 *
 * `/health` is the one exception to "everything goes through handleMobileDashboardHttp": it is
 * unauthenticated on purpose (a process supervisor checking liveness has no bearer token to
 * offer) and reports only that the HTTP listener itself is accepting connections -- not that the
 * dashboard data path behind it is configured or healthy. Every other path, including a typo of
 * `/health`, still goes through the real handler and its GET-only/Bearer-auth/scope checks.
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
      const result = handleMobileDashboardHttp(dashboardRequest, {
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
