import { validateOperationalProgressSnapshot, type OperationalProgressSnapshot } from "../../../packages/contracts/src/operationalProgress";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";
export type OperationalProgressLoadResult = { readonly status: "READY"; readonly snapshot: OperationalProgressSnapshot } | { readonly status: "NOT_CONFIGURED"; readonly reason: string } | { readonly status: "UNAVAILABLE"; readonly reason: string };
export interface OperationalProgressClientOptions { readonly baseUrl: string; readonly credentialProvider: DashboardCredentialProvider; readonly request?: typeof fetch; readonly timeoutMs?: number; }
const normalize = (value: string): string => value.trim().replace(/\/+$/, "");
const secure = (value: string): boolean => { try { const url = new URL(value); if (url.username || url.password) return false; if (url.protocol === "https:") return true; if (url.protocol !== "http:") return false; return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()); } catch { return false; } };
export async function loadOperationalProgress(options: OperationalProgressClientOptions): Promise<OperationalProgressLoadResult> {
  const configured = getConfiguredPaperEndpoint();
  if (configured == null || normalize(options.baseUrl) !== configured || !isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Verified Supervisor endpoint is not configured." });
  if (!secure(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "Supervisor credential will not be sent over insecure remote HTTP." });
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) return Object.freeze({ status: "UNAVAILABLE", reason: "Supervisor progress timeout is invalid." });
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const requestToken = token.trim(); const endpoint = new URL(`${configured}/api/operational-progress`).href; const controller = new AbortController(); let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => { const response = await (options.request ?? fetch)(endpoint, { method: "GET", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${requestToken}`, accept: "application/json" } }); if (response.redirected === true || (response.url && new URL(response.url).href !== endpoint)) throw new Error("Supervisor progress endpoint changed."); return response; })();
    const timeout = new Promise<never>((_, reject) => { handle = setTimeout(() => { controller.abort(); reject(new Error("Supervisor progress request timed out.")); }, timeoutMs); });
    const response = await Promise.race([operation, timeout]); if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `Supervisor progress unavailable (${response.status}).` }); const payload: unknown = await response.json(); const currentToken = await options.credentialProvider();
    if (getConfiguredPaperEndpoint() !== configured || !isPaperConnectionVerified(configured) || currentToken == null || currentToken.trim() !== requestToken) return Object.freeze({ status: "UNAVAILABLE", reason: "Supervisor connection changed while the request was in flight." });
    try { return Object.freeze({ status: "READY", snapshot: validateOperationalProgressSnapshot(payload) }); } catch { return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid or stale Supervisor progress snapshot." }); }
  } catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Supervisor progress connection is unavailable." }); } finally { if (handle !== undefined) clearTimeout(handle); }
}
