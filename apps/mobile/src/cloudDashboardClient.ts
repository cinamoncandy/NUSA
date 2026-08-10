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

function isDashboard(value: unknown): value is MobileDashboardResponse {
  if (value == null || typeof value !== "object") return false;
  const dashboard = value as Record<string, unknown>;
  if (typeof dashboard.apiVersion !== "number") return false;
  if (typeof dashboard.mode !== "string") return false;
  if (typeof dashboard.killSwitchActive !== "boolean") return false;
  if (typeof dashboard.tradingAllowed !== "boolean") return false;
  if (typeof dashboard.overallHealth !== "string") return false;
  if (!Array.isArray(dashboard.decisions)) return false;
  return true;
}

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
 * Reads the authenticated, read-only cloud dashboard state. The dashboard represents
 * the current operational status (mode, kill switch, trading allowed, health) and active
 * strategy decisions from the cloud runtime. Read-only; no mutations allowed.
 */
export async function loadCloudDashboard(
  options: CloudDashboardClientOptions
): Promise<CloudDashboardLoadResult> {
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure cloud dashboard credential is not configured." });
  }

  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!isSecureDashboardEndpoint(baseUrl)) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Cloud dashboard endpoint must use HTTPS unless it is loopback-only." });
  }

  try {
    const response = await (options.request ?? fetch)(`${baseUrl}/api/dashboard`, {
      method: "GET",
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" }
    });
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `Cloud dashboard unavailable (${response.status}).` });
    const payload: unknown = await response.json();
    if (!isDashboard(payload)) return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid cloud dashboard response." });
    return Object.freeze({ status: "READY", dashboard: payload });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", reason: "Cloud dashboard connection is unavailable." });
  }
}
