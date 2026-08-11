import { authorizeDashboardReadRequest, dashboardJsonResponse, type DashboardHttpRequest, type DashboardTokenVerifier } from "./mobileDashboardHttp";
import type { InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";

export function handleInvestmentAllocationHttp(
  request: DashboardHttpRequest & { readonly body?: string },
  deps: { readonly tokenVerifier: DashboardTokenVerifier; readonly repository: InvestmentAllocationSettingsRepository }
) {
  const method = request.method.toUpperCase();
  const auth = authorizeDashboardReadRequest(request, deps.tokenVerifier, method === "GET" ? "settings:read" : "settings:write", ["GET", "PUT", "POST"]);
  if (!auth.ok) return auth.response;
  try {
    if (method === "GET") {
      const setting = deps.repository.get(auth.principal.userId);
      return dashboardJsonResponse(200, {
        investmentPercent: setting?.investmentPercent ?? 100,
        reservePercent: setting == null ? 0 : 100 - setting.investmentPercent,
        revision: setting?.revision ?? 0,
        source: setting?.source ?? "DEFAULT"
      });
    }
    if (method !== "PUT" && method !== "POST") return dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    const payload = JSON.parse(request.body ?? "");
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return dashboardJsonResponse(400, { error: "INVALID_PAYLOAD" });
    const record = payload as Record<string, unknown>;
    const saved = deps.repository.save(auth.principal.userId, record.investmentPercent as number, record.revision as number | undefined);
    return dashboardJsonResponse(200, { ...saved, reservePercent: 100 - saved.investmentPercent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "settings unavailable";
    return dashboardJsonResponse(message.includes("stale") ? 409 : message.includes("invalid") || message.includes("between") ? 400 : 503, {
      error: message.includes("stale") ? "STALE_REVISION" : "INVALID_SETTINGS"
    });
  }
}
