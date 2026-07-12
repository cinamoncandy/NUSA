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
  readonly scopes: readonly string[];
}

export interface DashboardTokenVerifier {
  verify(token: string): DashboardPrincipal | undefined;
}

export interface MobileDashboardHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadDashboard: (principal: DashboardPrincipal) => MobileDashboardResponse;
}

const json = (status: number, payload: unknown): DashboardHttpResponse => Object.freeze({
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

export function handleMobileDashboardHttp(
  request: DashboardHttpRequest,
  dependencies: MobileDashboardHttpDependencies
): DashboardHttpResponse {
  if (request.method.toUpperCase() !== "GET") {
    return Object.freeze({
      ...json(405, { error: "METHOD_NOT_ALLOWED" }),
      headers: Object.freeze({ ...json(405, {}).headers, allow: "GET" })
    });
  }

  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return json(401, { error: "UNAUTHORIZED" });

  let principal: DashboardPrincipal | undefined;
  try {
    principal = dependencies.tokenVerifier.verify(token);
  } catch {
    return json(401, { error: "UNAUTHORIZED" });
  }
  if (principal == null || !principal.userId.trim()) return json(401, { error: "UNAUTHORIZED" });
  if (!principal.scopes.includes("dashboard:read")) return json(403, { error: "FORBIDDEN" });

  try {
    const dashboard = dependencies.loadDashboard(Object.freeze({
      userId: principal.userId.trim(),
      scopes: Object.freeze([...principal.scopes])
    }));
    return json(200, dashboard);
  } catch {
    return json(503, { error: "DASHBOARD_UNAVAILABLE" });
  }
}
