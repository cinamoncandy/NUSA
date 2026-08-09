import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  handleMobileDashboardHttp,
  type DashboardHttpRequest,
  type DashboardTokenVerifier,
  type MobileDashboardHttpDependencies
} from "./mobileDashboardHttp";
import {
  handlePersonalPaperOperationsHttp,
  type PersonalPaperOperationsHttpDependencies
} from "./personalPaperOperationsHttp";
import { operationalLog } from "./structuredOperationalLog";

export interface CloudReadinessSnapshot {
  readonly ok: boolean;
  readonly checks: Readonly<{
    database: boolean;
    migrations: boolean;
    dashboardPersistence: boolean;
    runtimeRecovery: boolean;
  }>;
}

export interface CloudDashboardServerOptions {
  readonly port: number;
  /** Defaults to "127.0.0.1". Binding beyond localhost is a deliberate, separate decision. */
  readonly host?: string;
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: MobileDashboardHttpDependencies["loadDashboard"];
  readonly loadPaperOperations?: PersonalPaperOperationsHttpDependencies["loadSnapshot"];
  /** Optional stricter readiness projection. Missing callback falls back to the durable dashboard read path. */
  readonly readiness?: () => CloudReadinessSnapshot;
}

export interface CloudDashboardServerHandle {
  readonly port: number;
  readonly host: string;
  stop(): Promise<void>;
}

const write = (res: ServerResponse, result: Readonly<{ status: number; headers: Readonly<Record<string, string>>; body: string }>): void => {
  res.writeHead(result.status, result.headers as Record<string, string>);
  res.end(result.body);
};

const ready = (): CloudReadinessSnapshot => Object.freeze({
  ok: true,
  checks: Object.freeze({ database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true })
});
const unavailable = (): CloudReadinessSnapshot => Object.freeze({
  ok: false,
  checks: Object.freeze({ database: false, migrations: false, dashboardPersistence: false, runtimeRecovery: false })
});
const correlationId = (req: IncomingMessage): string => {
  const value = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  return randomUUID();
};

/**
 * Localhost-by-default read-only dashboard transport. `/api/paper-operations`, `/ready`, and the
 * legacy dashboard projection share the same GET-only Bearer + `dashboard:read` authorization
 * boundary. `/health` is deliberately unauthenticated liveness only.
 *
 * No token issuer, mutation route, LIVE authority, or permissive fallback is provided here.
 */
export function startCloudDashboardServer(options: CloudDashboardServerOptions): CloudDashboardServerHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error("invalid cloud dashboard server port");
  }
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") {
    throw new Error("cloud dashboard server must bind to localhost");
  }

  const server: Server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestId = correlationId(req);
    try {
      if (req.method === "GET" && req.url === "/health") {
        write(res, dashboardJsonResponse(200, { ok: true, observedAt: new Date().toISOString() }));
        return;
      }

      const dashboardRequest: DashboardHttpRequest = Object.freeze({
        method: req.method ?? "GET",
        headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>)
      });

      if (req.url === "/ready") {
        const authorization = authorizeDashboardReadRequest(dashboardRequest, options.tokenVerifier);
        if (!authorization.ok) {
          operationalLog("WARN", "cloud.readiness.authorization_failed", requestId, { status: authorization.response.status });
          write(res, authorization.response);
          return;
        }
        try {
          const readiness = options.readiness?.() ?? (() => {
            // Current runtime initializes/migrates durable storage before opening this server.
            // A successful authenticated dashboard read therefore proves that the initialized
            // persistence/recovery path can serve a real projection; failure is fail-closed.
            options.loadDashboard(authorization.principal);
            return ready();
          })();
          const checks = Object.freeze({
            database: readiness.checks.database === true,
            migrations: readiness.checks.migrations === true,
            dashboardPersistence: readiness.checks.dashboardPersistence === true,
            runtimeRecovery: readiness.checks.runtimeRecovery === true
          });
          const ok = readiness.ok === true && Object.values(checks).every(Boolean);
          operationalLog(ok ? "INFO" : "WARN", "cloud.readiness", requestId, { ok, checks });
          write(res, dashboardJsonResponse(ok ? 200 : 503, { ok, checks }));
        } catch {
          const readiness = unavailable();
          operationalLog("ERROR", "cloud.readiness", requestId, { ok: readiness.ok, checks: readiness.checks });
          write(res, dashboardJsonResponse(503, readiness));
        }
        return;
      }

      const result = req.url === "/api/paper-operations"
        ? handlePersonalPaperOperationsHttp(dashboardRequest, {
            tokenVerifier: options.tokenVerifier,
            loadSnapshot: options.loadPaperOperations ?? (() => { throw new Error("PAPER operations snapshot not configured"); })
          })
        : handleMobileDashboardHttp(dashboardRequest, {
            tokenVerifier: options.tokenVerifier,
            loadDashboard: options.loadDashboard
          });

      write(res, result);
    } catch {
      operationalLog("ERROR", "cloud.http.unavailable", requestId, { method: req.method ?? null, path: req.url ?? null });
      if (!res.headersSent) {
        write(res, dashboardJsonResponse(503, { error: "DASHBOARD_SERVER_UNAVAILABLE" }));
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
