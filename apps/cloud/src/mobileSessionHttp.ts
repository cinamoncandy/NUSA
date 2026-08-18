import {
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";
import type { NusaUserAccessRepository } from "./operatorUserAccess";
import { isUserAllowed } from "./operatorUserAccess";
import type { MobileSessionService } from "./mobileSessionService";

export interface MobileSessionHttpDependencies {
  readonly sessionService: MobileSessionService;
  readonly legacyTokenVerifier: DashboardTokenVerifier;
  readonly userAccessRepository: NusaUserAccessRepository;
}

const bearer = (value: string | undefined): string | undefined => /^Bearer\s+([^\s]+)$/i.exec(value?.trim() ?? "")?.[1];

function jsonObject(body: string | undefined): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function methodOnly(request: DashboardHttpRequest, method: "GET" | "POST"): DashboardHttpResponse | undefined {
  if (request.method.toUpperCase() === method) return undefined;
  const response = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  return Object.freeze({ ...response, headers: Object.freeze({ ...response.headers, allow: method }) });
}

function authorizeOwner(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardPrincipal | undefined {
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return undefined;
  const principal = dependencies.legacyTokenVerifier.verify(token);
  if (principal == null || !principal.scopes.includes("users:manage")) return undefined;
  const actor = dependencies.userAccessRepository.get(principal.userId);
  if (actor?.role !== "OWNER" || !isUserAllowed(actor)) return undefined;
  return principal;
}

export function handleMobileBootstrapIssueHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  let principal: DashboardPrincipal | undefined;
  try { principal = authorizeOwner(request, dependencies); } catch { return dashboardJsonResponse(401, { error: "UNAUTHORIZED" }); }
  if (principal == null) return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  const input = jsonObject(request.body);
  const targetUserId = typeof input?.targetUserId === "string" ? input.targetUserId.trim() : "";
  const scopes = Array.isArray(input?.scopes) ? input.scopes.filter((value): value is string => typeof value === "string") : undefined;
  if (!targetUserId) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try {
    const issued = dependencies.sessionService.issueBootstrap({ actorUserId: principal.userId, targetUserId, ...(scopes ? { scopes } : {}) });
    return dashboardJsonResponse(201, issued);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ACTIVE")) return dashboardJsonResponse(409, { error: "TARGET_USER_NOT_ACTIVE" });
    if (message.includes("scope")) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_SESSION_SCOPES" });
    return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  }
}

export function handleMobileBootstrapHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const bootstrapToken = typeof input?.bootstrapToken === "string" ? input.bootstrapToken.trim() : "";
  if (!bootstrapToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try {
    const tokens = dependencies.sessionService.bootstrap(bootstrapToken);
    return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }); }
}

export function handleMobileSessionRefreshHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const refreshToken = typeof input?.refreshToken === "string" ? input.refreshToken.trim() : "";
  if (!refreshToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_REFRESH_REQUEST" });
  try {
    const tokens = dependencies.sessionService.refresh(refreshToken);
    return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }); }
}

export function handleMobileSessionRevokeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const accessToken = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (accessToken == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try {
    if (dependencies.sessionService.verifyAccess(accessToken) == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
    dependencies.sessionService.revokeAccess(accessToken);
    return dashboardJsonResponse(200, { revoked: true });
  } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}

export function handleMobileMeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "GET");
  if (methodError) return methodError;
  const accessToken = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (accessToken == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try {
    const me = dependencies.sessionService.me(accessToken);
    return me == null ? dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) : dashboardJsonResponse(200, me);
  } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}
