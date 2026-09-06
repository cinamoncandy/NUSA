import { createHash, timingSafeEqual } from "node:crypto";
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

export const MOBILE_ENROLLMENT_TOKEN_SHA256_ENV = "NUSA_MOBILE_ENROLLMENT_TOKEN_SHA256";
const SHA256_HEX = /^[a-f0-9]{64}$/;

const bearer = (value: string | undefined): string | undefined => /^Bearer\s+([^\s]+)$/i.exec(value?.trim() ?? "")?.[1];

/**
 * Optional migration boundary for a high-entropy credential that already exists on a mobile
 * device. Only its SHA-256 fingerprint is configured on Cloud. A match is accepted solely by
 * the first-run mobile enrollment route and is immediately exchanged for the normal rotating
 * PAPER-only mobile session. It never becomes a general dashboard bearer and grants no LIVE,
 * withdrawal, transfer, or production-mutation authority.
 */
export function matchesMobileEnrollmentTokenHash(token: string, configuredHash: string | undefined = process.env[MOBILE_ENROLLMENT_TOKEN_SHA256_ENV]): boolean {
  const expected = configuredHash?.trim().toLowerCase() ?? "";
  if (!SHA256_HEX.test(expected) || !token) return false;
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expectedBytes = Buffer.from(expected, "hex");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

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

function authorizeActiveUser(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardPrincipal | undefined {
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return undefined;
  let principal = dependencies.legacyTokenVerifier.verify(token);
  if (principal == null && matchesMobileEnrollmentTokenHash(token)) {
    principal = dependencies.legacyTokenVerifier.ownerPrincipal;
  }
  if (principal == null || !principal.userId.trim() || !principal.email?.trim()) return undefined;
  const user = dependencies.userAccessRepository.get(principal.userId.trim());
  if (!isUserAllowed(user) || user!.email !== principal.email.trim().toLowerCase()) return undefined;
  return principal;
}

/**
 * First-run enrollment for an already authenticated, approved user. The
 * caller's bearer is used only for this request; the issued capability is the
 * existing one-time mobile bootstrap token and is never persisted by Cloud.
 */
export function handleMobileEnrollmentHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  let principal: DashboardPrincipal | undefined;
  try { principal = authorizeActiveUser(request, dependencies); } catch { return dashboardJsonResponse(401, { error: "UNAUTHORIZED" }); }
  if (principal == null) return dashboardJsonResponse(403, { error: "USER_NOT_ACTIVE" });
  const input = jsonObject(request.body);
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  if (deviceId.length < 8 || deviceId.length > 256 || /[\r\n]/.test(deviceId)) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_ENROLLMENT_REQUEST" });
  try {
    const issued = dependencies.sessionService.issueSelfBootstrap({ actorUserId: principal.userId, deviceId });
    return dashboardJsonResponse(201, issued);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ACTIVE")) return dashboardJsonResponse(403, { error: "USER_NOT_ACTIVE" });
    if (message.includes("scope")) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_SESSION_SCOPES" });
    return dashboardJsonResponse(403, { error: "MOBILE_ENROLLMENT_REJECTED" });
  }
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
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : undefined;
  if (!bootstrapToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try {
    const tokens = dependencies.sessionService.bootstrap(bootstrapToken, Date.now(), deviceId);
    return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }); }
}

export function handleMobileSessionRefreshHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const refreshToken = typeof input?.refreshToken === "string" ? input.refreshToken.trim() : "";
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : undefined;
  if (!refreshToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_REFRESH_REQUEST" });
  try {
    const tokens = dependencies.sessionService.refresh(refreshToken, Date.now(), deviceId);
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
