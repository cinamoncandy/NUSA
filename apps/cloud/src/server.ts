import { createHash, randomUUID } from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  handleMobileDashboardHttp,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier,
  type MobileDashboardHttpDependencies
} from "./mobileDashboardHttp";
import {
  handlePersonalPaperOperationsHttp,
  type PersonalPaperOperationsHttpDependencies
} from "./personalPaperOperationsHttp";
import { handleShadowOperationsHttp, type ShadowOperationsHttpDependencies } from "./shadowOperationsHttp";
import { handleRealReadOnlyOperationsHttp, type RealReadOnlyOperationsHttpDependencies } from "./realReadOnlyOperationsHttp";
import { handlePersonalPaperOrderHttp, type PersonalPaperOrderHttpDependencies } from "./personalPaperOrderHttp";
import { operationalLog } from "./structuredOperationalLog";
import { handleInvestmentAllocationHttp } from "./investmentAllocationHttp";
import type { InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";
import { handleOperatorUserAccessHttp } from "./operatorUserAccessHttp";
import { isUserAllowed, SqliteNusaUserAccessRepository, type NusaUserAccessRepository } from "./operatorUserAccess";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { BoundedHttpRateLimiter, rateLimitIdentity } from "./httpRateLimiter";
import { DesktopSessionService } from "./desktopSessionService";
import {
  handleDesktopBootstrapHttp,
  handleDesktopBootstrapIssueHttp,
  handleDesktopMeHttp,
  handleDesktopSessionRefreshHttp,
  handleDesktopSessionRevokeHttp
} from "./desktopSessionHttp";
import { MobileSessionService } from "./mobileSessionService";
import {
  handleMobileBootstrapHttp,
  handleMobileBootstrapIssueHttp,
  handleMobileEnrollmentHttp,
  handleMobileMeHttp,
  handleMobileSessionRefreshHttp,
  handleMobileSessionRevokeHttp
} from "./mobileSessionHttp";
import { handlePublicUpbitQuotationHttp, isPublicUpbitQuotationPath } from "./publicUpbitQuotationHttp";
import { handleLiveReadinessHttp, type LiveReadinessHttpDependencies } from "./liveReadinessHttp";
import { handleEngineeringOperationsHttp, type EngineeringOperationsHttpDependencies } from "./engineeringOperationsHttp";
import { handleEvolutionLearningSupervisorHttp, type EvolutionLearningSupervisorHttpDependencies } from "./evolutionLearningSupervisorHttp";

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
  readonly loadShadowOperations?: ShadowOperationsHttpDependencies["loadSnapshot"];
  readonly loadRealReadOnlyOperations?: RealReadOnlyOperationsHttpDependencies["loadSnapshot"];
  readonly loadLiveReadiness?: LiveReadinessHttpDependencies["loadSnapshot"];
  readonly loadEngineeringOperations?: EngineeringOperationsHttpDependencies["loadSnapshot"];
  readonly loadEvolutionLearning?: EvolutionLearningSupervisorHttpDependencies["loadSnapshot"];
  readonly submitPaperOrder?: PersonalPaperOrderHttpDependencies["submitOrder"];
  readonly investmentAllocationSettings?: InvestmentAllocationSettingsRepository;
  readonly userAccessRepository?: NusaUserAccessRepository;
  readonly desktopSessionService?: DesktopSessionService;
  readonly mobileSessionService?: MobileSessionService;
  readonly readiness?: () => CloudReadinessSnapshot;
  readonly rateLimiter?: BoundedHttpRateLimiter;
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
const MAX_REQUEST_BODY_BYTES = 10_000;

class RequestBodyTooLargeError extends Error {
  public constructor() {
    super("request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  const declaredLength = req.headers["content-length"];
  if (typeof declaredLength === "string") {
    const length = Number(declaredLength);
    if (Number.isSafeInteger(length) && length > MAX_REQUEST_BODY_BYTES) {
      req.resume();
      return Promise.reject(new RequestBodyTooLargeError());
    }
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    let byteLength = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (settled) return;
      byteLength += Buffer.byteLength(chunk, "utf8");
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        fail(new RequestBodyTooLargeError());
        return;
      }
      value += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(value);
    });
    req.on("error", (error) => fail(error));
  });
}

const correlationId = (req: IncomingMessage): string => {
  const value = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  return randomUUID();
};

const actorRef = (userId: string | undefined): string | undefined => userId == null
  ? undefined
  : createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 16);

const auditHttpResponse = (
  requestId: string,
  request: DashboardHttpRequest,
  route: string,
  response: Readonly<{ status: number }>,
  principal: DashboardPrincipal | undefined
): void => {
  const severity = response.status >= 500 ? "ERROR" : response.status >= 400 ? "WARN" : "INFO";
  operationalLog(severity, `cloud.http.${route}`, requestId, {
    actorRef: actorRef(principal?.userId) ?? "ANONYMOUS",
    method: request.method.toUpperCase(),
    responseStatus: response.status,
    evidence: "HTTP_RESPONSE",
    ...(route === "paper_order" ? { authority: "PAPER_ONLY" } : {})
  });
};

export function startCloudDashboardServer(options: CloudDashboardServerOptions): CloudDashboardServerHandle {
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("invalid cloud dashboard server port");
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error("cloud dashboard server must bind to localhost");
  const rateLimiter = options.rateLimiter ?? new BoundedHttpRateLimiter();

  let ownedUserDb: SqliteDatabase | undefined;
  let userAccessRepository = options.userAccessRepository;
  if (userAccessRepository == null) {
    const pathname = process.env.NUSA_CLOUD_STATE_DB_PATH?.trim() || ":memory:";
    ownedUserDb = new SqliteDatabase(pathname);
    userAccessRepository = new SqliteNusaUserAccessRepository(ownedUserDb);
  }
  const desktopSessionService = options.desktopSessionService ?? (ownedUserDb == null ? undefined : new DesktopSessionService(ownedUserDb, userAccessRepository));
  const mobileSessionService = options.mobileSessionService ?? (ownedUserDb == null ? undefined : new MobileSessionService(ownedUserDb, userAccessRepository));

  const ownerPrincipal = options.tokenVerifier.ownerPrincipal;
  if (ownerPrincipal != null) {
    if (!ownerPrincipal.userId.trim() || !ownerPrincipal.email?.trim()) throw new Error("owner principal identity is incomplete");
    userAccessRepository.ensureOwner({
      id: ownerPrincipal.userId.trim(),
      email: ownerPrincipal.email.trim(),
      ...(ownerPrincipal.displayName?.trim() ? { displayName: ownerPrincipal.displayName.trim() } : {})
    });
  }

  const accessControlledTokenVerifier: DashboardTokenVerifier = Object.freeze({
    ...(ownerPrincipal == null ? {} : { ownerPrincipal }),
    verify(token: string) {
      try {
        // Session verifiers intentionally fail closed by throwing for malformed or
        // unknown session material. Keep the legacy shared-secret verifier reachable
        // when no mobile/desktop session matches, without treating a verifier error
        // as permission to bypass the remaining checks.
        let principal: DashboardPrincipal | undefined;
        try { principal = mobileSessionService?.verifyAccess(token); } catch { principal = undefined; }
        if (principal == null) {
          try { principal = desktopSessionService?.verifyAccess(token); } catch { principal = undefined; }
        }
        if (principal == null) {
          try { principal = options.tokenVerifier.verify(token); } catch { principal = undefined; }
        }
        if (principal == null || !principal.userId.trim()) return undefined;
        const principalEmail = principal.email?.trim().toLowerCase();
        if (!principalEmail) return undefined;
        let actor = userAccessRepository.get(principal.userId.trim());
        if (actor == null) {
          actor = userAccessRepository.registerUser({
            id: principal.userId.trim(),
            email: principalEmail,
            ...(principal.displayName?.trim() ? { displayName: principal.displayName.trim() } : {})
          });
        } else if (actor.email !== principalEmail) {
          return undefined;
        }
        if (!isUserAllowed(actor)) return undefined;
        try { userAccessRepository.markSeen(actor.id); } catch { return undefined; }
        return principal;
      } catch {
        return undefined;
      }
    }
  });

  const server: Server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = correlationId(req);
    const path = (() => { try { return new URL(req.url ?? "/", "http://localhost").pathname; } catch { return req.url ?? "/"; } })();
    if (path !== "/health") {
      const authorization = req.headers.authorization ?? req.headers.Authorization;
      const bucket = `${path}|${rateLimitIdentity(typeof authorization === "string" ? authorization : undefined, req.socket.remoteAddress)}`;
      const decision = rateLimiter.evaluate(bucket, requestId, req.method === "POST" || req.method === "PUT" ? 4 : 1);
      if (!decision.allowed) {
        req.resume();
        operationalLog("WARN", "cloud.rate_limit.blocked", requestId, { path, reason: decision.reason ?? "rate limit exceeded", authority: "PAPER_ONLY" });
        const base = dashboardJsonResponse(429, { error: "RATE_LIMITED" });
        write(res, Object.freeze({ ...base, headers: Object.freeze({ ...base.headers, "retry-after": String(decision.retryAfterSeconds ?? 1) }) }));
        return;
      }
    }
    let requestPrincipal: DashboardPrincipal | undefined;
    const requestTokenVerifier: DashboardTokenVerifier = Object.freeze({
      ...(ownerPrincipal == null ? {} : { ownerPrincipal }),
      verify(token: string) {
        const principal = accessControlledTokenVerifier.verify(token);
        requestPrincipal = principal;
        return principal;
      }
    });
    const respond = (route: string, result: DashboardHttpResponse): void => {
      auditHttpResponse(requestId, { method: req.method ?? "GET", headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>) }, route, result, requestPrincipal);
      write(res, result);
    };
    try {
      if (req.url === "/health") {
        if (req.method !== "GET") { respond("health", dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" })); return; }
        respond("health", dashboardJsonResponse(200, { ok: true, observedAt: new Date().toISOString() }));
        return;
      }

      if (isPublicUpbitQuotationPath(path)) {
        respond("public_upbit_quotation", await handlePublicUpbitQuotationHttp(req.url ?? path, req.method ?? "GET"));
        return;
      }

      const body = req.method === "POST" || req.method === "PUT" ? await readRequestBody(req) : undefined;
      const dashboardRequest: DashboardHttpRequest & { readonly body?: string } = Object.freeze({ method: req.method ?? "GET", headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>), ...(body === undefined ? {} : { body }) });

      if (desktopSessionService != null && req.url === "/api/operator/desktop-bootstrap") {
        respond("desktop_bootstrap_issue", handleDesktopBootstrapIssueHttp(dashboardRequest, { sessionService: desktopSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (desktopSessionService != null && req.url === "/v1/desktop/bootstrap") {
        respond("desktop_bootstrap", handleDesktopBootstrapHttp(dashboardRequest, { sessionService: desktopSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (desktopSessionService != null && req.url === "/v1/desktop/session/refresh") {
        respond("desktop_session_refresh", handleDesktopSessionRefreshHttp(dashboardRequest, { sessionService: desktopSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (desktopSessionService != null && req.url === "/v1/desktop/session/revoke") {
        respond("desktop_session_revoke", handleDesktopSessionRevokeHttp(dashboardRequest, { sessionService: desktopSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (desktopSessionService != null && req.url === "/v1/desktop/me") {
        const token = dashboardRequest.headers.authorization ?? dashboardRequest.headers.Authorization;
        if (typeof token === "string") {
          const raw = /^Bearer\s+([^\s]+)$/i.exec(token.trim())?.[1];
          if (raw) requestPrincipal = desktopSessionService.verifyAccess(raw);
        }
        respond("desktop_me", handleDesktopMeHttp(dashboardRequest, { sessionService: desktopSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }

      if (mobileSessionService != null && req.url === "/api/operator/mobile-bootstrap") {
        respond("mobile_bootstrap_issue", handleMobileBootstrapIssueHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (mobileSessionService != null && req.url === "/v1/mobile/bootstrap") {
        respond("mobile_bootstrap", handleMobileBootstrapHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (mobileSessionService != null && req.url === "/v1/mobile/enroll") {
        respond("mobile_enroll", handleMobileEnrollmentHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (mobileSessionService != null && req.url === "/v1/mobile/session/refresh") {
        respond("mobile_session_refresh", handleMobileSessionRefreshHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (mobileSessionService != null && req.url === "/v1/mobile/session/revoke") {
        respond("mobile_session_revoke", handleMobileSessionRevokeHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }
      if (mobileSessionService != null && req.url === "/v1/mobile/me") {
        const token = dashboardRequest.headers.authorization ?? dashboardRequest.headers.Authorization;
        if (typeof token === "string") {
          const raw = /^Bearer\s+([^\s]+)$/i.exec(token.trim())?.[1];
          if (raw) requestPrincipal = mobileSessionService.verifyAccess(raw);
        }
        respond("mobile_me", handleMobileMeHttp(dashboardRequest, { sessionService: mobileSessionService, legacyTokenVerifier: options.tokenVerifier, userAccessRepository }));
        return;
      }

      if (req.url === "/ready") {
        const authorization = authorizeDashboardReadRequest(dashboardRequest, requestTokenVerifier);
        if (!authorization.ok) { respond("readiness", authorization.response); return; }
        try {
          const readiness = options.readiness?.() ?? unavailable();
          const checks = Object.freeze({ database: readiness.checks.database === true, migrations: readiness.checks.migrations === true, dashboardPersistence: readiness.checks.dashboardPersistence === true, runtimeRecovery: readiness.checks.runtimeRecovery === true });
          const ok = readiness.ok === true && Object.values(checks).every(Boolean);
          operationalLog(ok ? "INFO" : "WARN", "cloud.readiness", requestId, { ok, checks });
          respond("readiness", dashboardJsonResponse(ok ? 200 : 503, { ok, checks }));
        } catch { const readiness = unavailable(); operationalLog("ERROR", "cloud.readiness", requestId, { ok: readiness.ok, checks: readiness.checks }); respond("readiness", dashboardJsonResponse(503, readiness)); }
        return;
      }

      if (req.url === "/api/paper-orders") {
        let payload: unknown = null;
        if ((req.method ?? "GET").toUpperCase() === "POST") {
          try { payload = JSON.parse(body ?? ""); }
          catch { respond("paper_order", dashboardJsonResponse(400, { error: "INVALID_JSON" })); return; }
        }
        respond("paper_order", handlePersonalPaperOrderHttp(dashboardRequest, payload, {
          tokenVerifier: requestTokenVerifier,
          submitOrder: options.submitPaperOrder ?? (() => { throw new Error("PAPER order submission not configured"); }),
          loadSnapshot: options.loadPaperOperations
        }));
        return;
      }
      if (req.url === "/api/paper-operations") { respond("paper_operations", handlePersonalPaperOperationsHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadPaperOperations ?? (() => { throw new Error("PAPER operations snapshot not configured"); }) })); return; }
      if (req.url === "/api/shadow-operations") { respond("shadow_operations", handleShadowOperationsHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadShadowOperations ?? (() => { throw new Error("SHADOW operations snapshot not configured"); }) })); return; }
      if (req.url === "/api/real-readonly-operations") { respond("real_readonly_operations", handleRealReadOnlyOperationsHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadRealReadOnlyOperations ?? (() => { throw new Error("REAL_READ_ONLY operations snapshot not configured"); }) })); return; }
      if (req.url === "/api/live-readiness") { respond("live_readiness", handleLiveReadinessHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadLiveReadiness ?? (() => { throw new Error("LIVE readiness source not configured"); }) })); return; }
      if (req.url === "/api/engineering-operations") { respond("engineering_operations", handleEngineeringOperationsHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadEngineeringOperations ?? (() => { throw new Error("Engineering OS snapshot not configured"); }) })); return; }
      if (req.url === "/api/evolution-learning") { respond("evolution_learning", handleEvolutionLearningSupervisorHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadSnapshot: options.loadEvolutionLearning ?? (() => { throw new Error("Evolution learning snapshot not configured"); }) })); return; }
      if (req.url === "/api/dashboard") { respond("dashboard", handleMobileDashboardHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, loadDashboard: options.loadDashboard })); return; }
      if (req.url === "/api/operator/users") { respond("operator_users", handleOperatorUserAccessHttp(dashboardRequest, { tokenVerifier: requestTokenVerifier, repository: userAccessRepository })); return; }
      if (req.url === "/api/settings/investment-allocation" && options.investmentAllocationSettings != null) {
        let payload: unknown = null;
        if (["PUT", "POST"].includes((req.method ?? "GET").toUpperCase())) {
          try { payload = JSON.parse(body ?? ""); }
          catch { respond("investment_allocation", dashboardJsonResponse(400, { error: "INVALID_JSON" })); return; }
        }
        respond("investment_allocation", handleInvestmentAllocationHttp(dashboardRequest, payload, { tokenVerifier: requestTokenVerifier, repository: options.investmentAllocationSettings }));
        return;
      }
      respond("unknown_route", dashboardJsonResponse(404, { error: "NOT_FOUND" }));
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        respond("request_body", dashboardJsonResponse(413, { error: "REQUEST_BODY_TOO_LARGE" }));
        return;
      }
      operationalLog("ERROR", "cloud.http.unavailable", requestId, { method: req.method ?? null, path: req.url ?? null });
      if (!res.headersSent) respond("server_error", dashboardJsonResponse(503, { error: "DASHBOARD_SERVER_UNAVAILABLE" })); else res.destroy();
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