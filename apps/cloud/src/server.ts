import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authorizeDashboardReadRequest, dashboardJsonResponse, handleMobileDashboardHttp, type DashboardHttpRequest, type DashboardTokenVerifier, type MobileDashboardHttpDependencies } from "./mobileDashboardHttp";
import { handlePersonalPaperOperationsHttp, type PersonalPaperOperationsHttpDependencies } from "./personalPaperOperationsHttp";
import { handlePersonalPaperOrderHttp, type PersonalPaperOrderHttpDependencies } from "./personalPaperOrderHttp";
import { handleInvestmentAllocationHttp } from "./investmentAllocationHttp";
import type { InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";
import { operationalLog } from "./structuredOperationalLog";

export interface CloudReadinessSnapshot { readonly ok: boolean; readonly checks: Readonly<{ database: boolean; migrations: boolean; dashboardPersistence: boolean; runtimeRecovery: boolean }>; }
export interface CloudDashboardServerOptions {
  readonly port: number; readonly host?: string; readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: MobileDashboardHttpDependencies["loadDashboard"];
  readonly loadPaperOperations?: PersonalPaperOperationsHttpDependencies["loadSnapshot"];
  readonly submitPaperOrder?: PersonalPaperOrderHttpDependencies["submitOrder"];
  readonly investmentAllocationSettings?: InvestmentAllocationSettingsRepository;
  readonly readiness?: () => CloudReadinessSnapshot;
}
export interface CloudDashboardServerHandle { readonly port: number; readonly host: string; stop(): Promise<void>; }
const write = (res: ServerResponse, result: Readonly<{ status: number; headers: Readonly<Record<string, string>>; body: string }>): void => { res.writeHead(result.status, result.headers as Record<string, string>); res.end(result.body); };
const unavailable = (): CloudReadinessSnapshot => Object.freeze({ ok: false, checks: Object.freeze({ database: false, migrations: false, dashboardPersistence: false, runtimeRecovery: false }) });
const correlationId = (req: IncomingMessage): string => { const value = req.headers["x-correlation-id"] ?? req.headers["x-request-id"]; if (typeof value === "string" && value.trim()) return value.trim(); if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim(); return randomUUID(); };
class HttpBodyError extends Error { public constructor(public readonly status: 400 | 413, message: string) { super(message); } }
async function readJsonBody(req: IncomingMessage, maximumBytes = 16 * 1024): Promise<unknown> {
  const rawLength = req.headers["content-length"];
  if (typeof rawLength === "string" && Number(rawLength) > maximumBytes) throw new HttpBodyError(413, "REQUEST_TOO_LARGE");
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.byteLength; if (bytes > maximumBytes) throw new HttpBodyError(413, "REQUEST_TOO_LARGE"); chunks.push(value); }
  if (bytes === 0) throw new HttpBodyError(400, "INVALID_JSON");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpBodyError(400, "INVALID_JSON"); }
}

export function startCloudDashboardServer(options: CloudDashboardServerOptions): CloudDashboardServerHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("invalid cloud dashboard server port");
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error("cloud dashboard server must bind to localhost");
  const server: Server = http.createServer((req: IncomingMessage, res: ServerResponse) => { void (async () => {
    const requestId = correlationId(req);
    try {
      if (req.url === "/health") { if (req.method !== "GET") { write(res, dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" })); return; } write(res, dashboardJsonResponse(200, { ok: true, observedAt: new Date().toISOString() })); return; }
      const dashboardRequest: DashboardHttpRequest = Object.freeze({ method: req.method ?? "GET", headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>) });
      if (req.url === "/ready") {
        const authorization = authorizeDashboardReadRequest(dashboardRequest, options.tokenVerifier);
        if (!authorization.ok) { operationalLog("WARN", "cloud.readiness.authorization_failed", requestId, { status: authorization.response.status }); write(res, authorization.response); return; }
        try { const readiness = options.readiness?.() ?? unavailable(); const checks = Object.freeze({ database: readiness.checks.database === true, migrations: readiness.checks.migrations === true, dashboardPersistence: readiness.checks.dashboardPersistence === true, runtimeRecovery: readiness.checks.runtimeRecovery === true }); const ok = readiness.ok === true && Object.values(checks).every(Boolean); operationalLog(ok ? "INFO" : "WARN", "cloud.readiness", requestId, { ok, checks }); write(res, dashboardJsonResponse(ok ? 200 : 503, { ok, checks })); }
        catch { const readiness = unavailable(); operationalLog("ERROR", "cloud.readiness", requestId, { ok: readiness.ok, checks: readiness.checks }); write(res, dashboardJsonResponse(503, readiness)); }
        return;
      }
      if (req.url === "/api/settings/investment-allocation") {
        if (options.investmentAllocationSettings == null) { write(res, dashboardJsonResponse(503, { error: "SETTINGS_UNAVAILABLE" })); return; }
        let body: unknown = null;
        if (["PUT", "POST"].includes((req.method ?? "GET").toUpperCase())) {
          try { body = await readJsonBody(req); }
          catch (error) { if (error instanceof HttpBodyError) { write(res, dashboardJsonResponse(error.status, { error: error.message })); return; } write(res, dashboardJsonResponse(400, { error: "INVALID_JSON" })); return; }
        }
        write(res, handleInvestmentAllocationHttp(dashboardRequest, body, { tokenVerifier: options.tokenVerifier, repository: options.investmentAllocationSettings }));
        return;
      }
      if (req.url === "/api/paper-orders") {
        let body: unknown = null;
        if ((req.method ?? "GET").toUpperCase() === "POST") { try { body = await readJsonBody(req); } catch (error) { if (error instanceof HttpBodyError) { write(res, dashboardJsonResponse(error.status, { error: error.message })); return; } write(res, dashboardJsonResponse(400, { error: "INVALID_JSON" })); return; } }
        write(res, handlePersonalPaperOrderHttp(dashboardRequest, body, {
          tokenVerifier: options.tokenVerifier,
          submitOrder: options.submitPaperOrder ?? (() => { throw new Error("PAPER order submission not configured"); }),
          loadSnapshot: options.loadPaperOperations
        })); return;
      }
      if (req.url === "/api/paper-operations") { write(res, handlePersonalPaperOperationsHttp(dashboardRequest, { tokenVerifier: options.tokenVerifier, loadSnapshot: options.loadPaperOperations ?? (() => { throw new Error("PAPER operations snapshot not configured"); }) })); return; }
      if (req.url === "/api/dashboard") { write(res, handleMobileDashboardHttp(dashboardRequest, { tokenVerifier: options.tokenVerifier, loadDashboard: options.loadDashboard })); return; }
      write(res, dashboardJsonResponse(404, { error: "NOT_FOUND" }));
    } catch { operationalLog("ERROR", "cloud.http.unavailable", requestId, { method: req.method ?? null, path: req.url ?? null }); if (!res.headersSent) write(res, dashboardJsonResponse(503, { error: "DASHBOARD_SERVER_UNAVAILABLE" })); else res.destroy(); }
  })(); });
  const sockets = new Set<import("node:net").Socket>(); server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); }); server.listen(options.port, host);
  let stopping: Promise<void> | undefined;
  return { port: options.port, host, stop(): Promise<void> { if (stopping) return stopping; stopping = new Promise((resolve) => { server.close(() => resolve()); for (const socket of sockets) socket.destroy(); }); return stopping; } };
}
