import { dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse, type DashboardTokenVerifier } from "./mobileDashboardHttp";
import type { InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";

function bearer(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  return /^Bearer\s+([^\s]+)$/i.exec(value.trim())?.[1];
}

function authorizeSettings(
  request: DashboardHttpRequest,
  tokenVerifier: DashboardTokenVerifier,
  requiredScope: "settings:read" | "settings:write"
): Readonly<{ ok: true; userId: string } | { ok: false; response: DashboardHttpResponse }> {
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });
  try {
    const principal = tokenVerifier.verify(token);
    if (principal == null || !principal.userId.trim()) return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });
    if (!principal.scopes.includes(requiredScope)) return Object.freeze({ ok: false, response: dashboardJsonResponse(403, { error: "FORBIDDEN" }) });
    return Object.freeze({ ok: true, userId: principal.userId.trim() });
  } catch {
    return Object.freeze({ ok: false, response: dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) });
  }
}

export function handleInvestmentAllocationHttp(
  request: DashboardHttpRequest,
  body: unknown,
  deps: { readonly tokenVerifier: DashboardTokenVerifier; readonly repository: InvestmentAllocationSettingsRepository }
): DashboardHttpResponse {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "PUT" && method !== "POST") {
    const base = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    return Object.freeze({ ...base, headers: Object.freeze({ ...base.headers, allow: "GET, PUT, POST" }) });
  }
  const auth = authorizeSettings(request, deps.tokenVerifier, method === "GET" ? "settings:read" : "settings:write");
  if (!auth.ok) return auth.response;
  try {
    if (method === "GET") {
      const setting = deps.repository.get(auth.userId);
      return dashboardJsonResponse(200, {
        investmentPercent: setting?.investmentPercent ?? 100,
        reservePercent: setting == null ? 0 : 100 - setting.investmentPercent,
        revision: setting?.revision ?? 0,
        source: setting?.source ?? "DEFAULT"
      });
    }
    if (body == null || typeof body !== "object" || Array.isArray(body)) return dashboardJsonResponse(400, { error: "INVALID_PAYLOAD" });
    const record = body as Record<string, unknown>;
    const saved = deps.repository.save(auth.userId, record.investmentPercent as number, record.revision as number | undefined);
    return dashboardJsonResponse(200, { ...saved, reservePercent: 100 - saved.investmentPercent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "settings unavailable";
    return dashboardJsonResponse(message.includes("stale") ? 409 : message.includes("invalid") || message.includes("between") ? 400 : 503, { error: message.includes("stale") ? "STALE_REVISION" : "INVALID_SETTINGS" });
  }
}
