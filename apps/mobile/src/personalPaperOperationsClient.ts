import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../packages/contracts/src/personalPaperOperations";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

export type DashboardCredentialProvider = () => Promise<string | null>;

export type PersonalPaperOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: PersonalPaperOperationsSnapshot }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface PersonalPaperOperationsClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
  /** Settings-only connection probe. Normal reads must never opt out of verified endpoint binding. */
  readonly allowUnverifiedEndpoint?: boolean;
}

export const unavailableDashboardCredentialProvider: DashboardCredentialProvider = async () => null;

function normalizeEndpoint(value: string): string { return value.trim().replace(/\/+$/, ""); }
function isSecureDashboardEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch { return false; }
}

/** Uses only the explicitly saved endpoint. Normal reads require that exact endpoint to be verified before credential access. */
export async function loadPersonalPaperOperations(options: PersonalPaperOperationsClientOptions): Promise<PersonalPaperOperationsLoadResult> {
  const configured = getConfiguredPaperEndpoint();
  if (configured == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured. Open Settings and save the Cloud endpoint." });

  // Only the Settings connection probe may name a requested endpoint, and it must be the exact
  // configured endpoint. Normal reads intentionally ignore caller/env base URLs and use the
  // configured+verified Settings endpoint below so credentials can never be redirected by env.
  const requested = normalizeEndpoint(options.baseUrl);
  if (options.allowUnverifiedEndpoint === true && requested !== configured) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint does not match the configured connection." });
  if (options.allowUnverifiedEndpoint !== true && !isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified in Settings before credentials can be used." });
  if (!isSecureDashboardEndpoint(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "Dashboard credential will not be sent over insecure remote HTTP." });

  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });

  try {
    const response = await (options.request ?? fetch)(`${configured}/api/paper-operations`, {
      method: "GET",
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" }
    });
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `PAPER operations unavailable (${response.status}).` });
    const payload: unknown = await response.json();
    try { return Object.freeze({ status: "READY", snapshot: validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot) }); }
    catch { return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid or stale PAPER operations snapshot." }); }
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER operations connection is unavailable." });
  }
}
