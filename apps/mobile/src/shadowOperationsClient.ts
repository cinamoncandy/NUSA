import {
  validateShadowObservabilitySnapshot,
  type ShadowObservabilitySnapshot
} from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

export type ShadowOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: ShadowObservabilitySnapshot }
  | { readonly status: "NOT_CONFIGURED" | "UNAVAILABLE"; readonly reason: string };

export interface ShadowOperationsClientOptions {
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

export async function loadShadowOperations(options: ShadowOperationsClientOptions): Promise<ShadowOperationsLoadResult> {
  const configured = getConfiguredPaperEndpoint();
  if (configured == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured." });
  if (options.baseUrl.trim().replace(/\/+$/, "") !== configured) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Shadow endpoint does not match the verified PAPER endpoint." });
  if (!isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before Shadow reads." });
  if (!secureEndpoint(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "Shadow observability refuses insecure remote HTTP." });
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) return Object.freeze({ status: "UNAVAILABLE", reason: "Shadow operations timeout is invalid." });
  const endpoint = new URL(`${configured}/api/shadow-operations`).href;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (options.request ?? fetch)(endpoint, { method: "GET", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" } });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Shadow operations request timed out.")); }, timeoutMs); });
    const response = await Promise.race([request, timeout]);
    if (response.redirected === true || (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint)) throw new Error("Shadow operations final endpoint changed.");
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `Shadow operations unavailable (${response.status}).` });
    const payload = await response.json() as ShadowObservabilitySnapshot;
    const currentEndpoint = getConfiguredPaperEndpoint();
    const currentToken = await options.credentialProvider();
    if (currentEndpoint !== configured || !isPaperConnectionVerified(configured) || currentToken == null || currentToken.trim() !== token.trim()) return Object.freeze({ status: "UNAVAILABLE", reason: "SHADOW connection changed while the request was in flight." });
    return Object.freeze({ status: "READY", snapshot: validateShadowObservabilitySnapshot(payload) });
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Shadow operations connection is unavailable." });
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
