import type { MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";

export interface DashboardHttpRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface DashboardHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface DashboardPrincipal {
  readonly userId: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly scopes: readonly string[];
}

export interface DashboardTokenVerifier {
  readonly ownerPrincipal?: DashboardPrincipal;
  verify(token: string): DashboardPrincipal | undefined;
}

export interface MobileDashboardHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: (principal: DashboardPrincipal) => MobileDashboardResponse;
}

export const dashboardJsonResponse = (status: number, payload: unknown): DashboardHttpResponse => Object.freeze({
  status,
  headers: Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "pragma": "no-cache"
  }),
  body: JSON.stringify(payload)
});

const bearer = (value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match?.[1];
};

export type DashboardReadAuthorization =
  | { readonly ok: true; readonly principal: DashboardPrincipal }
  | { readonly ok: false; readonly response: DashboardHttpResponse };

/** Shared fail-closed authorization boundary for every read-only dashboard projection. */
export function authorizeDashboardReadRequest(
  request: DashboardHttpRequest,
  tokenVerifier: DashboardTokenVerifier,
  requiredScope = "dashboard:read",
  allowedMethods: readonly string[] = ["GET"]
): DashboardReadAuthorization {
  const method = request.method.toUpperCase();
  if (!allowedMethods.some((allowedMethod) => allowedMethod.toUpperCase() === method)) {
    return Object.freeze({
      ok: false,
      response: Object.freeze({
        ...dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" }),
        headers: Object.freeze({ ...dashboardJsonResponse(405, {}).headers, allow: allowedMethods.join(", ") })
      })
    });
  }

  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });

  let principal: DashboardPrincipal | undefined;
  try {
    principal = tokenVerifier.verify(token);
  } catch {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });
  }
  if (principal == null || !principal.userId.trim()) {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });
  }
  if (!principal.scopes.includes(requiredScope)) {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(403, { error: "FORBIDDEN" }) });
  }

  return Object.freeze({
    ok: true,
    principal: Object.freeze({
      userId: principal.userId.trim(),
      ...(principal.email?.trim() ? { email: principal.email.trim().toLowerCase() } : {}),
      ...(principal.displayName?.trim() ? { displayName: principal.displayName.trim() } : {}),
      scopes: Object.freeze([...principal.scopes])
    })
  });
}

export function handleMobileDashboardHttp(
  request: DashboardHttpRequest,
  dependencies: MobileDashboardHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;

  try {
    return dashboardJsonResponse(200, dependencies.loadDashboard(authorization.principal));
  } catch {
    return dashboardJsonResponse(503, { error: "DASHBOARD_UNAVAILABLE" });
  }
}
