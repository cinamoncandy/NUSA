import { dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse, type DashboardPrincipal, type DashboardTokenVerifier } from "./mobileDashboardHttp";
import type { MobileSessionService } from "./mobileSessionService";
import { isUserAllowed, type NusaUserAccessRepository } from "./operatorUserAccess";

export interface MobileSessionHttpDependencies { readonly sessionService: MobileSessionService; readonly legacyTokenVerifier?: DashboardTokenVerifier; readonly userAccessRepository?: NusaUserAccessRepository; }
const bearer = (value: string | undefined): string | undefined => /^Bearer\s+([^\s]+)$/i.exec(value?.trim() ?? "")?.[1];
const jsonObject = (body: string | undefined): Record<string, unknown> | undefined => { try { const value = body == null ? undefined : JSON.parse(body) as unknown; return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } catch { return undefined; } };
const methodOnly = (request: DashboardHttpRequest, method: "GET" | "POST"): DashboardHttpResponse | undefined => request.method.toUpperCase() === method ? undefined : Object.freeze({ ...dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" }), headers: Object.freeze({ ...dashboardJsonResponse(405, {}).headers, allow: method }) });
const owner = (request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardPrincipal | undefined => { const token = bearer(request.headers.authorization ?? request.headers.Authorization); if (!token || !dependencies.legacyTokenVerifier || !dependencies.userAccessRepository) return undefined; const principal = dependencies.legacyTokenVerifier.verify(token); const actor = principal == null ? undefined : dependencies.userAccessRepository.get(principal.userId); return principal != null && actor?.role === "OWNER" && isUserAllowed(actor) ? principal : undefined; };

export function handleMobileBootstrapIssueHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const actor = owner(request, dependencies); if (actor == null || !dependencies.userAccessRepository) return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  const input = jsonObject(request.body); const targetUserId = typeof input?.targetUserId === "string" ? input.targetUserId.trim() : "";
  if (!targetUserId) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try { return dashboardJsonResponse(201, dependencies.sessionService.issueBootstrap({ actorUserId: actor.userId, targetUserId, ...(Array.isArray(input?.scopes) ? { scopes: input!.scopes!.filter((value): value is string => typeof value === "string") } : {}) })); } catch { return dashboardJsonResponse(403, { error: "FORBIDDEN" }); }
}

export function handleMobileBootstrapHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const input = jsonObject(request.body); const token = typeof input?.bootstrapToken === "string" ? input.bootstrapToken.trim() : "";
  if (!token) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try { const tokens = dependencies.sessionService.bootstrap(token); return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }) : dashboardJsonResponse(200, tokens); } catch { return dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }); }
}
export function handleMobileSessionRefreshHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const input = jsonObject(request.body); const token = typeof input?.refreshToken === "string" ? input.refreshToken.trim() : "";
  if (!token) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_REFRESH_REQUEST" });
  try { const tokens = dependencies.sessionService.refresh(token); return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }) : dashboardJsonResponse(200, tokens); } catch { return dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }); }
}
export function handleMobileSessionRevokeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const token = bearer(request.headers.authorization ?? request.headers.Authorization); if (!token || dependencies.sessionService.verifyAccess(token) == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try { dependencies.sessionService.revokeAccess(token); return dashboardJsonResponse(200, { revoked: true }); } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}
export function handleMobileMeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "GET"); if (methodError) return methodError;
  const token = bearer(request.headers.authorization ?? request.headers.Authorization); if (!token) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try { const me = dependencies.sessionService.me(token); return me == null ? dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) : dashboardJsonResponse(200, me); } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}
