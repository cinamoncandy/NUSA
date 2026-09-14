import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../packages/contracts/src/personalPaperOperations";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";
import { takeLastCredentialFailure, takeLastCredentialRefusal } from "./dashboardCredentialSession";
import type { RefusalDescriptor } from "./instrumentState";

export type DashboardProjectionOutcome = "READY" | "PROJECTION_UNAVAILABLE" | "AUTH_REJECTED";

export interface DashboardCredentialProvider {
  (): Promise<string | null>;
  noteProjectionResult?: (outcome: DashboardProjectionOutcome) => void;
}

export type PersonalPaperOperationsLoadResult =
  | { readonly status: "READY"; readonly snapshot: PersonalPaperOperationsSnapshot }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  /**
   * `refusal` is present only when a gate named the cause. Client-side conditions -- an
   * unverified endpoint, an invalid timeout -- carry a sentence and nothing more, because
   * inventing a gate for them would claim a diagnosis nobody made.
   */
  | { readonly status: "UNAVAILABLE"; readonly reason: string; readonly refusal?: RefusalDescriptor };

export interface PersonalPaperOperationsClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  /** Settings-only connection probe. Normal reads must never opt out of verified endpoint binding. */
  readonly allowUnverifiedEndpoint?: boolean;
}

export const unavailableDashboardCredentialProvider: DashboardCredentialProvider = async () => null;

function noteProjectionResult(provider: DashboardCredentialProvider, outcome: DashboardProjectionOutcome): void {
  provider.noteProjectionResult?.(outcome);
}

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

const MAX_PROJECTION_REASON_LENGTH = 300;

/**
 * Turns a projection validation failure into something the operator can act on. The staleness
 * and future-dated checks compare a server-generated timestamp against this device's clock, so
 * they fail whenever the two disagree by more than the contract's window -- which reads as a
 * broken connection even though the credential and the data are both fine.
 */
export function describeProjectionRejection(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (message.includes("stale")) return "서버가 보낸 PAPER 상태가 기기 시계 기준으로 너무 오래되었습니다. 기기와 서버의 시간이 맞는지 확인하세요.";
  if (message.includes("from the future")) return "서버가 보낸 PAPER 상태의 시각이 기기 시계보다 앞서 있습니다. 기기와 서버의 시간이 맞는지 확인하세요.";
  if (!message) return "PAPER 운영 projection을 해석할 수 없습니다.";
  return `PAPER 운영 projection이 유효하지 않습니다: ${message.slice(0, MAX_PROJECTION_REASON_LENGTH)}`;
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
  if (token == null || !token.trim()) {
    // The provider signals every failure the same way, so a recorded reason distinguishes a
    // rejected exchange from a genuinely unconfigured credential. Without it an expired token
    // reported itself as a configuration problem.
    const failure = takeLastCredentialFailure();
    const refusal = takeLastCredentialRefusal();
    return failure == null
      ? Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." })
      : Object.freeze({ status: "UNAVAILABLE", reason: failure, ...(refusal == null ? {} : { refusal }) });
  }
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
    if (!response.ok) {
      noteProjectionResult(options.credentialProvider, response.status === 401 || response.status === 403 ? "AUTH_REJECTED" : "PROJECTION_UNAVAILABLE");
      return Object.freeze({ status: "UNAVAILABLE", reason: `PAPER operations unavailable (${response.status}).` });
    }
    const payload: unknown = await response.json();
    const currentToken = await options.credentialProvider();
    const endpointStillCurrent = getConfiguredPaperEndpoint() === configured;
    const verificationStillCurrent = options.allowUnverifiedEndpoint === true || isPaperConnectionVerified(configured);
    if (!endpointStillCurrent || !verificationStillCurrent || currentToken == null || currentToken.trim() !== requestToken) {
      noteProjectionResult(options.credentialProvider, "PROJECTION_UNAVAILABLE");
      return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER connection changed while the request was in flight." });
    }
    try {
      const snapshot = validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot);
      noteProjectionResult(options.credentialProvider, "READY");
      return Object.freeze({ status: "READY", snapshot });
    } catch (error) {
      noteProjectionResult(options.credentialProvider, "PROJECTION_UNAVAILABLE");
      // The validator distinguishes a stale snapshot, one dated in the future, a health
      // mismatch and a malformed projection, and each points somewhere different -- a snapshot
      // judged stale or future-dated usually means the device and server clocks disagree, not
      // that anything is wrong with the data. Collapsing them into one sentence hid that.
      return Object.freeze({ status: "UNAVAILABLE", reason: describeProjectionRejection(error) });
    }
  } catch (error) {
    noteProjectionResult(options.credentialProvider, "PROJECTION_UNAVAILABLE");
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER operations connection is unavailable." });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}