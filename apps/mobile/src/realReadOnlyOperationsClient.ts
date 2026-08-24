import {
  validateRealReadOnlyObservabilitySnapshot,
  type RealReadOnlyObservabilitySnapshot
} from "../../../packages/contracts/src/realReadOnlyObservability";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

/**
 * Mobile REAL_READ_ONLY read client. Deliberately a near-copy of shadowOperationsClient.ts so the
 * two read paths cannot drift apart on the parts that matter: same verified-endpoint gate, same
 * secure-transport gate, same bounded timeout, same in-flight session-change recheck, same
 * redirect refusal, and the same validate-before-return.
 *
 * No broker credential is involved anywhere here. The only secret this carries is the existing
 * dashboard session token; the real broker credential stays on the Cloud/desktop side and never
 * crosses into the app.
 */
export type RealReadOnlyOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: RealReadOnlyObservabilitySnapshot }
  | { readonly status: "NOT_CONFIGURED" | "UNAVAILABLE"; readonly reason: string };

export interface RealReadOnlyOperationsClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}

function secureEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]");
  } catch { return false; }
}

export async function loadRealReadOnlyOperations(options: RealReadOnlyOperationsClientOptions): Promise<RealReadOnlyOperationsLoadResult> {
  const configured = getConfiguredPaperEndpoint();
  if (configured == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." });
  if (options.baseUrl.trim().replace(/\/+$/, "") !== configured) return Object.freeze({ status: "NOT_CONFIGURED", reason: "REAL_READ_ONLY endpoint does not match the verified PAPER endpoint." });
  if (!isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before REAL_READ_ONLY reads." });
  if (!secureEndpoint(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "REAL_READ_ONLY observability refuses insecure remote HTTP." });
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) return Object.freeze({ status: "UNAVAILABLE", reason: "REAL_READ_ONLY operations timeout is invalid." });
  const endpoint = new URL(`${configured}/api/real-readonly-operations`).href;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (options.request ?? fetch)(endpoint, { method: "GET", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" } });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("REAL_READ_ONLY operations request timed out.")); }, timeoutMs); });
    const response = await Promise.race([request, timeout]);
    if (response.redirected === true || (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint)) throw new Error("REAL_READ_ONLY operations final endpoint changed.");
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `REAL_READ_ONLY operations unavailable (${response.status}).` });
    const payload = await response.json() as RealReadOnlyObservabilitySnapshot;
    const currentEndpoint = getConfiguredPaperEndpoint();
    const currentToken = await options.credentialProvider();
    if (currentEndpoint !== configured || !isPaperConnectionVerified(configured) || currentToken == null || currentToken.trim() !== token.trim()) return Object.freeze({ status: "UNAVAILABLE", reason: "REAL_READ_ONLY connection changed while the request was in flight." });
    return Object.freeze({ status: "READY", snapshot: validateRealReadOnlyObservabilitySnapshot(payload) });
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "REAL_READ_ONLY operations connection is unavailable." });
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
