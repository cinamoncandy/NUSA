import { dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse } from "./mobileDashboardHttp";
import { MobileAuthError, type MobileSessionAuthority } from "./mobileAuth";

export interface MobileAuthHttpDependencies {
  readonly authority: MobileSessionAuthority;
}

const bearer = (value: string | undefined): string | undefined => value == null ? undefined : /^Bearer\s+([^\s]+)$/i.exec(value.trim())?.[1];

function parseObject(body: string | undefined): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  try {
    const value: unknown = JSON.parse(body);
    return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function errorResponse(error: unknown): DashboardHttpResponse {
  if (error instanceof MobileAuthError) {
    const status = error.code === "AUTH_REQUIRED" || error.code === "SESSION_EXPIRED" || error.code === "SESSION_REVOKED" || error.code === "BOOTSTRAP_DENIED" ? 401 : 400;
    return dashboardJsonResponse(status, { error: error.code });
  }
  return dashboardJsonResponse(503, { error: "AUTH_UNAVAILABLE" });
}

export function handleMobileAuthHttp(
  request: DashboardHttpRequest & { readonly body?: string },
  path: "/api/mobile/session/bootstrap" | "/api/mobile/session/refresh" | "/api/mobile/session/revoke",
  dependencies: MobileAuthHttpDependencies
): DashboardHttpResponse {
  if (request.method.toUpperCase() !== "POST") {
    const base = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    return Object.freeze({ ...base, headers: Object.freeze({ ...base.headers, allow: "POST" }) });
  }

  try {
    if (path === "/api/mobile/session/revoke") {
      const token = bearer(request.headers.authorization ?? request.headers.Authorization);
      if (token == null) return dashboardJsonResponse(401, { error: "AUTH_REQUIRED" });
      dependencies.authority.revokeAccess(token);
      return dashboardJsonResponse(200, { revoked: true });
    }

    const input = parseObject(request.body);
    if (input == null) return dashboardJsonResponse(400, { error: "INVALID_ARGUMENT" });
    if (path === "/api/mobile/session/bootstrap") {
      const proof = typeof input.proof === "string" ? input.proof : "";
      const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
      return dashboardJsonResponse(200, dependencies.authority.bootstrap({ proof, deviceId }));
    }
    const refreshToken = typeof input.refreshToken === "string" ? input.refreshToken : "";
    return dashboardJsonResponse(200, dependencies.authority.refresh(refreshToken));
  } catch (error) {
    return errorResponse(error);
  }
}

