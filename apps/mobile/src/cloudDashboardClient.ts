import type { MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";

export type DashboardCredentialProvider = () => Promise<string | null>;
export type CloudDashboardLoadResult =
  | { readonly status: "READY"; readonly dashboard: MobileDashboardResponse }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface CloudDashboardClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
}

export const unavailableDashboardCredentialProvider: DashboardCredentialProvider = async () => null;

function isDashboardResponse(value: unknown): value is MobileDashboardResponse {
  if (value == null || typeof value !== "object") return false;
  const dashboard = value as Partial<MobileDashboardResponse>;
  // MOBILE_DASHBOARD_API_VERSION (packages/contracts/src/mobileDashboard.ts) is the string
  // "1", not a number -- a numeric check here would reject every real server response.
  if (dashboard.apiVersion !== "1") return false;
  if (typeof dashboard.generatedAt !== "number") return false;
  if (dashboard.mode !== "PAPER" && dashboard.mode !== "STOPPED" && dashboard.mode !== "FAULTED") return false;
  if (typeof dashboard.killSwitchActive !== "boolean") return false;
  if (dashboard.overallHealth !== "HEALTHY" && dashboard.overallHealth !== "DEGRADED" && dashboard.overallHealth !== "DOWN") return false;
  if (typeof dashboard.tradingAllowed !== "boolean") return false;
  if (!Array.isArray(dashboard.positions) || !Array.isArray(dashboard.decisions) || !Array.isArray(dashboard.issues)) return false;
  if (!Array.isArray(dashboard.staleIntelligenceSources)) return false;
  return true;
}

/** Same loopback/HTTPS boundary as personalPaperOperationsClient.ts's sibling read-only
 * client: apps/cloud's dashboard server only ever binds to localhost (see server.ts), so a
 * non-loopback baseUrl is only legitimate over HTTPS. Anything else fails closed here before
 * a request is ever sent, rather than trusting the network to enforce it. */
function isSecureDashboardEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Reads the authenticated, read-only mobile dashboard projection from apps/cloud's
 * `GET /api/dashboard` (see mobileDashboardHttp.ts's `dashboard:read` boundary). This client
 * has no mutation method -- there is no path from a phone reading this response to placing an
 * order. If no secure credential provider is wired, this performs no network request and
 * fails closed as NOT_CONFIGURED, matching the sibling PAPER-operations client.
 */
export async function loadCloudDashboard(options: CloudDashboardClientOptions): Promise<CloudDashboardLoadResult> {
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  }

  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!isSecureDashboardEndpoint(baseUrl)) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Dashboard endpoint must use HTTPS unless it is loopback-only." });
  }

  try {
    const response = await (options.request ?? fetch)(`${baseUrl}/api/dashboard`, {
      method: "GET",
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" }
    });
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `Cloud dashboard unavailable (${response.status}).` });
    const payload: unknown = await response.json();
    if (!isDashboardResponse(payload)) return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid cloud dashboard response." });
    return Object.freeze({ status: "READY", dashboard: payload });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", reason: "Cloud dashboard connection is unavailable." });
  }
}
