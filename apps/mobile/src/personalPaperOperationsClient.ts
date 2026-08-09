import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../packages/contracts/src/personalPaperOperations";
import { getConfiguredPaperEndpoint } from "./paperConnectionSession";

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

/** Uses only an explicitly saved endpoint. Historical localhost fallback is ignored unless saved by the operator. */
export async function loadPersonalPaperOperations(
  options: PersonalPaperOperationsClientOptions
): Promise<PersonalPaperOperationsLoadResult> {
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) {
    return Object.freeze({
      status: "NOT_CONFIGURED",
      reason: "Secure dashboard credential is not configured."
    });
  }

  const configured = getConfiguredPaperEndpoint();
  const fallback = options.baseUrl === "http://127.0.0.1:41731" ? "" : options.baseUrl;
  const baseUrl = (configured ?? fallback).replace(/\/+$/, "");
  if (!baseUrl) {
    return Object.freeze({
      status: "NOT_CONFIGURED",
      reason: "PAPER endpoint is not configured. Open Settings and save the Cloud endpoint."
    });
  }
  if (!isSecureDashboardEndpoint(baseUrl)) {
    return Object.freeze({
      status: "NOT_CONFIGURED",
      reason: "Dashboard credential will not be sent over insecure remote HTTP."
    });
  }

  try {
    const response = await (options.request ?? fetch)(`${baseUrl}/api/paper-operations`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token.trim()}`,
        accept: "application/json"
      }
    });
    if (!response.ok) {
      return Object.freeze({
        status: "UNAVAILABLE",
        reason: `PAPER operations unavailable (${response.status}).`
      });
    }

    const payload: unknown = await response.json();
    try {
      return Object.freeze({
        status: "READY",
        snapshot: validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot)
      });
    } catch {
      return Object.freeze({
        status: "UNAVAILABLE",
        reason: "Invalid or stale PAPER operations snapshot."
      });
    }
  } catch {
    return Object.freeze({
      status: "UNAVAILABLE",
      reason: "PAPER operations connection is unavailable."
    });
  }
}
