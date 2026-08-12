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
import { handlePersonalPaperOrderHttp, type PersonalPaperOrderHttpDependencies } from "./personalPaperOrderHttp";
import { operationalLog } from "./structuredOperationalLog";
import { handleInvestmentAllocationHttp } from "./investmentAllocationHttp";
import type { InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";
import { handleOperatorUserAccessHttp } from "./operatorUserAccessHttp";
import { isUserAllowed, SqliteNusaUserAccessRepository, type NusaUserAccessRepository } from "./operatorUserAccess";
import { SqliteDatabase } from "../../../packages/storage/src/index";

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
  readonly host?: string;
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: MobileDashboardHttpDependencies["loadDashboard"];
  readonly loadPaperOperations?: PersonalPaperOperationsHttpDependencies["loadSnapshot"];
  readonly submitPaperOrder?: PersonalPaperOrderHttpDependencies["submitOrder"];
  readonly investmentAllocationSettings?: InvestmentAllocationSettingsRepository;
  readonly userAccessRepository?: NusaUserAccessRepository;
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
const unavailable = (): CloudReadinessSnapshot => Object.freeze({ ok: false, checks: Object.freeze({ database: false, migrations: false, dashboardPersistence: false, runtimeRecovery: false }) });
const correlationId = (req: IncomingMessage): string => {
  const value = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  return randomUUID();
};

export function startCloudDashboardServer(options: CloudDashboardServerOptions): CloudDashboardServerHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("invalid cloud dashboard server port");
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error("cloud dashboard server must bind to localhost");

  let ownedUserDb: SqliteDatabase | undefined;
  let userAccessRepository = options.userAccessRepository;
  if (userAccessRepository == null) {
    const pathname = process.env.NUSA_CLOUD_STATE_DB_PATH?.trim() || ":memory:";
    ownedUserDb = new SqliteDatabase(pathname);
    userAccessRepository = new SqliteNusaUserAccessRepository(ownedUserDb);
  }
  userAccessRepository.ensureOwner({ id: "operator", email: process.env.NUSA_OWNER_EMAIL?.trim() || "operator@nusa.local", displayName: "NUSA Owner" });

  // Authentication is necessary but not sufficient: approval status is a
  // durable server-side authorization boundary for every protected route.
  const accessControlledTokenVerifier: DashboardTokenVerifier = Object.freeze({
    verify(token: string) {
      try {
        const principal = options.tokenVerifier.verify(token);
        if (principal == null) return undefined;
        return isUserAllowed(userAccessRepository.get(principal.userId)) ? principal : undefined;
      } catch {
        return undefined;
      }
    }
  });

  const server: Server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = correlationId(req);
    try {
      if (req.url === "/health") {
        if (req.method !== "GET") { write(res, dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" })); return; }
        write(res, dashboardJsonResponse(200, { ok: true, observedAt: new Date().toISOString() }));
        return;
      }

      const body = req.method === "POST" || req.method === "PUT" ? await new Promise<string>((resolve, reject) => { let value = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { value += chunk; if (value.length > 10000) reject(new Error("request body too large")); }); req.on("end", () => resolve(value)); req.on("error", reject); }) : undefined;
      const dashboardRequest: DashboardHttpRequest & { readonly body?: string } = Object.freeze({ method: req.method ?? "GET", headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>), ...(body === undefined ? {} : { body }) });

      if (req.url === "/ready") {
        const authorization = authorizeDashboardReadRequest(dashboardRequest, accessControlledTokenVerifier);
        if (!authorization.ok) { operationalLog("WARN", "cloud.readiness.authorization_failed", requestId, { status: authorization.response.status }); write(res, authorization.response); return; }
        try {
          const readiness = options.readiness?.() ?? unavailable();
          const checks = Object.freeze({ database: readiness.checks.database === true, migrations: readiness.checks.migrations === true, dashboardPersistence: readiness.checks.dashboardPersistence === true, runtimeRecovery: readiness.checks.runtimeRecovery === true });
          const ok = readiness.ok === true && Object.values(checks).every(Boolean);
          operationalLog(ok ? "INFO" : "WARN", "cloud.readiness", requestId, { ok, checks });
          write(res, dashboardJsonResponse(ok ? 200 : 503, { ok, checks }));
        } catch { const readiness = unavailable(); operationalLog("ERROR", "cloud.readiness", requestId, { ok: readiness.ok, checks: readiness.checks }); write(res, dashboardJsonResponse(503, readiness)); }
        return;
      }

      if (req.url === "/api/paper-orders") {
        let payload: unknown = null;
        if ((req.method ?? "GET").toUpperCase() === "POST") {
          try { payload = JSON.parse(body ?? ""); }
          catch { write(res, dashboardJsonResponse(400, { error: "INVALID_JSON" })); return; }
        }
        write(res, handlePersonalPaperOrderHttp(dashboardRequest, payload, {
          tokenVerifier: accessControlledTokenVerifier,
          submitOrder: options.submitPaperOrder ?? (() => { throw new Error("PAPER order submission not configured"); }),
          loadSnapshot: options.loadPaperOperations
        }));
        return;
      }
      if (req.url === "/api/paper-operations") { write(res, handlePersonalPaperOperationsHttp(dashboardRequest, { tokenVerifier: accessControlledTokenVerifier, loadSnapshot: options.loadPaperOperations ?? (() => { throw new Error("PAPER operations snapshot not configured"); }) })); return; }
      if (req.url === "/api/dashboard") { write(res, handleMobileDashboardHttp(dashboardRequest, { tokenVerifier: accessControlledTokenVerifier, loadDashboard: options.loadDashboard })); return; }
      if (req.url === "/api/operator/users") { write(res, handleOperatorUserAccessHttp(dashboardRequest, { tokenVerifier: accessControlledTokenVerifier, repository: userAccessRepository })); return; }
      if (req.url === "/api/settings/investment-allocation" && options.investmentAllocationSettings != null) { write(res, handleInvestmentAllocationHttp(dashboardRequest, { tokenVerifier: accessControlledTokenVerifier, repository: options.investmentAllocationSettings })); return; }
      write(res, dashboardJsonResponse(404, { error: "NOT_FOUND" }));
    } catch {
      operationalLog("ERROR", "cloud.http.unavailable", requestId, { method: req.method ?? null, path: req.url ?? null });
      if (!res.headersSent) write(res, dashboardJsonResponse(503, { error: "DASHBOARD_SERVER_UNAVAILABLE" })); else res.destroy();
    }
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(options.port, host);

  let stopping: Promise<void> | undefined;
  return {
    port: options.port,
    host,
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopping = new Promise((resolve) => {
        server.close(() => { try { ownedUserDb?.close(); } finally { resolve(); } });
        for (const socket of sockets) socket.destroy();
      });
      return stopping;
    }
  };
}
