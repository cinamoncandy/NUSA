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
  readonly timeoutMs?: number;
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
function readTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("PAPER operations timeout must be an integer in (0, 30000]");
  return timeoutMs;
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

  let timeoutMs: number;
  try { timeoutMs = readTimeoutMs(options.timeoutMs); }
  catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER operations timeout is invalid." }); }
  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const requestToken = token.trim();

  const endpoint = new URL(`${configured}/api/paper-operations`).href;
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const response = await (options.request ?? fetch)(endpoint, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { authorization: `Bearer ${requestToken}`, accept: "application/json" }
      });
      if (response.redirected === true) throw new Error("PAPER operations redirect is prohibited.");
      if (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint) throw new Error("PAPER operations final endpoint changed.");
      return response;
    })();
    const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => { controller.abort(); reject(new Error("PAPER operations request timed out.")); }, timeoutMs); });
    const response = await Promise.race([operation, timeout]);
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `PAPER operations unavailable (${response.status}).` });
    const payload: unknown = await response.json();
    const currentToken = await options.credentialProvider();
    const endpointStillCurrent = getConfiguredPaperEndpoint() === configured;
    const verificationStillCurrent = options.allowUnverifiedEndpoint === true || isPaperConnectionVerified(configured);
    if (!endpointStillCurrent || !verificationStillCurrent || currentToken == null || currentToken.trim() !== requestToken) {
      return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER connection changed while the request was in flight." });
    }
    try { return Object.freeze({ status: "READY", snapshot: validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot) }); }
    catch { return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid or stale PAPER operations snapshot." }); }
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER operations connection is unavailable." });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}