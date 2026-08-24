import {
  validateLiveReadinessObservabilitySnapshot,
  type LiveReadinessObservabilitySnapshot,
} from "../../../packages/contracts/src/liveReadinessObservability";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

export type LiveReadinessOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: LiveReadinessObservabilitySnapshot }
  | { readonly status: "NOT_CONFIGURED" | "UNAVAILABLE"; readonly reason: string };

export interface LiveReadinessOperationsClientOptions {
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

/** GET-only LIVE preparation client. It has no activation, order, or broker credential API. */
export async function loadLiveReadinessOperations(options: LiveReadinessOperationsClientOptions): Promise<LiveReadinessOperationsLoadResult> {
  const configured = getConfiguredPaperEndpoint();
  if (configured == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." });
  if (options.baseUrl.trim().replace(/\/+$/, "") !== configured) return Object.freeze({ status: "NOT_CONFIGURED", reason: "LIVE readiness endpoint does not match the verified PAPER endpoint." });
  if (!isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before LIVE readiness reads." });
  if (!secureEndpoint(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "LIVE readiness refuses insecure remote HTTP." });
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) return Object.freeze({ status: "UNAVAILABLE", reason: "LIVE readiness timeout is invalid." });
  const endpoint = new URL(`${configured}/api/live-readiness`).href;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (options.request ?? fetch)(endpoint, { method: "GET", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" } });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("LIVE readiness request timed out.")); }, timeoutMs); });
    const response = await Promise.race([request, timeout]);
    if (response.redirected === true || (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint)) throw new Error("LIVE readiness final endpoint changed.");
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `LIVE readiness unavailable (${response.status}).` });
    const payload = await response.json() as LiveReadinessObservabilitySnapshot;
    const currentEndpoint = getConfiguredPaperEndpoint();
    const currentToken = await options.credentialProvider();
    if (currentEndpoint !== configured || !isPaperConnectionVerified(configured) || currentToken == null || currentToken.trim() !== token.trim()) return Object.freeze({ status: "UNAVAILABLE", reason: "LIVE readiness connection changed while the request was in flight." });
    return Object.freeze({ status: "READY", snapshot: validateLiveReadinessObservabilitySnapshot(payload) });
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "LIVE readiness connection is unavailable." });
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
