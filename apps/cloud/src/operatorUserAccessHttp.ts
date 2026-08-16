import { dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse, type DashboardPrincipal, type DashboardTokenVerifier } from "./mobileDashboardHttp";
import { isUserAllowed, type NusaUserAccessAction, type NusaUserAccessRepository } from "./operatorUserAccess";

export interface OperatorUserAccessHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly repository: NusaUserAccessRepository;
}

const actions = new Set<NusaUserAccessAction>(["APPROVE", "REJECT", "SUSPEND", "RESTORE"]);

const bearer = (value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  return /^Bearer\s+([^\s]+)$/i.exec(value.trim())?.[1];
};

function authorizeOperatorRequest(
  request: DashboardHttpRequest,
  tokenVerifier: DashboardTokenVerifier,
  repository: NusaUserAccessRepository
): { readonly ok: true; readonly principal: DashboardPrincipal } | { readonly ok: false; readonly response: DashboardHttpResponse } {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    const response = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    return Object.freeze({ ok: false, response: Object.freeze({ ...response, headers: Object.freeze({ ...response.headers, allow: "GET, POST" }) }) });
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
  if (principal.authDomain === "MOBILE") {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(403, { error: "FORBIDDEN" }) });
  }
  const actor = repository.get(principal.userId);
  if (actor?.role !== "OWNER" || !isUserAllowed(actor)) {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(403, { error: "FORBIDDEN" }) });
  }
  if (!principal.scopes.includes("users:manage")) {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(403, { error: "FORBIDDEN" }) });
  }

  return Object.freeze({
    ok: true,
    principal: Object.freeze({ userId: principal.userId.trim(), scopes: Object.freeze([...principal.scopes]) })
  });
}

function parseBody(body: string | undefined): Readonly<{ targetUserId: string; action: NusaUserAccessAction; reason?: string }> | undefined {
  if (body == null) return undefined;
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const targetUserId = typeof value.targetUserId === "string" ? value.targetUserId.trim() : "";
    const action = typeof value.action === "string" ? value.action.toUpperCase() as NusaUserAccessAction : undefined;
    const reason = typeof value.reason === "string" ? value.reason.trim() : undefined;
    if (!targetUserId || action == null || !actions.has(action)) return undefined;
    return Object.freeze({ targetUserId, action, ...(reason ? { reason } : {}) });
  } catch {
    return undefined;
  }
}

export function handleOperatorUserAccessHttp(
  request: DashboardHttpRequest & { readonly body?: string },
  dependencies: OperatorUserAccessHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizeOperatorRequest(request, dependencies.tokenVerifier, dependencies.repository);
  if (!authorization.ok) return authorization.response;

  if (request.method.toUpperCase() === "GET") {
    try {
      return dashboardJsonResponse(200, { users: dependencies.repository.list(), audit: dependencies.repository.listAudit(100) });
    } catch {
      return dashboardJsonResponse(503, { error: "USER_ACCESS_UNAVAILABLE" });
    }
  }

  const input = parseBody(request.body);
  if (input == null) return dashboardJsonResponse(400, { error: "INVALID_USER_ACCESS_REQUEST" });
  try {
    const user = dependencies.repository.changeStatus({ actorUserId: authorization.principal.userId, targetUserId: input.targetUserId, action: input.action, ...(input.reason ? { reason: input.reason } : {}) });
    return dashboardJsonResponse(200, { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("not found")) return dashboardJsonResponse(404, { error: "USER_NOT_FOUND" });
    if (message.includes("authority") || message.includes("owner access")) return dashboardJsonResponse(403, { error: "FORBIDDEN" });
    return dashboardJsonResponse(409, { error: "USER_ACCESS_CHANGE_REJECTED" });
  }
}
