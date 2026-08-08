import type { PersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";

export type DashboardCredentialProvider = () => Promise<string | null>;
export type PersonalPaperOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: PersonalPaperOperationsSnapshot }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface PersonalPaperOperationsClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
}

export const unavailableDashboardCredentialProvider: DashboardCredentialProvider = async () => null;

function isSnapshot(value: unknown): value is PersonalPaperOperationsSnapshot {
  if (value == null || typeof value !== "object") return false;
  const snapshot = value as Partial<PersonalPaperOperationsSnapshot>;
  if (snapshot.schemaVersion !== 1) return false;
  if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) return false;
  if (snapshot.dashboard == null || snapshot.operations == null) return false;
  if (!Array.isArray(snapshot.orders) || !Array.isArray(snapshot.markets)) return false;
  if (snapshot.portfolio !== null && snapshot.portfolio !== undefined && snapshot.portfolio.mode !== "PAPER") return false;
  if (snapshot.research != null) {
    if (snapshot.research.liveAuthority !== "NONE" || snapshot.research.productionMutationAllowed !== false) return false;
    if (snapshot.research.champion.authority !== "PAPER_ONLY" || snapshot.research.challenger.authority !== "ZERO_AUTHORITY") return false;
  }
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
 * Reads the authenticated, read-only personal PAPER operations snapshot. Local foundation sign-in
 * is intentionally not treated as server authentication. If no secure credential provider is
 * wired, this function performs no network request and fails closed as NOT_CONFIGURED.
 */
export async function loadPersonalPaperOperations(
  options: PersonalPaperOperationsClientOptions
): Promise<PersonalPaperOperationsLoadResult> {
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  }

  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!isSecureDashboardEndpoint(baseUrl)) {
    return Object.freeze({ status: "NOT_CONFIGURED", reason: "Dashboard endpoint must use HTTPS unless it is loopback-only." });
  }

  try {
    const response = await (options.request ?? fetch)(`${baseUrl}/api/paper-operations`, {
      method: "GET",
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" }
    });
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `PAPER operations unavailable (${response.status}).` });
    const payload: unknown = await response.json();
    if (!isSnapshot(payload)) return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid PAPER operations snapshot." });
    return Object.freeze({ status: "READY", snapshot: payload });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER operations connection is unavailable." });
  }
}
