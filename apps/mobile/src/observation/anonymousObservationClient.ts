import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../../packages/contracts/src/personalPaperOperations";
import { getCanonicalCloudOrigin } from "../canonicalOrigin";
import { getConfiguredPaperEndpoint } from "../paperConnectionSession";
import { describeProjectionRejection } from "../personalPaperOperationsClient";

/**
 * Read-only PAPER observation that carries no credential.
 *
 * The credentialed client in personalPaperOperationsClient.ts stays the authority for anything a
 * session can do. This one exists so the learning/strategy projection is reachable before, or
 * without, the enrollment ceremony -- it pairs with the server's anonymous observation allowlist.
 *
 * It is deliberately a separate module rather than a flag on the credentialed path: that path
 * binds the response to the exact token it was fetched with, and threading "sometimes there is no
 * token" through those checks would weaken the guarantee they exist to provide.
 */

/** The only path this client will request. It is on the server's read-only allowlist. */
const OBSERVATION_PATH = "/api/paper-operations";

export type AnonymousObservationResult =
  | { readonly status: "READY"; readonly snapshot: PersonalPaperOperationsSnapshot }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface AnonymousObservationOptions {
  /** Defaults to the configured PAPER endpoint, then to the build's canonical origin. */
  readonly baseUrl?: string;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  readonly environment?: Record<string, string | undefined>;
}

function normalizeEndpoint(value: string): string { return value.trim().replace(/\/+$/, ""); }

/**
 * HTTPS only, except for loopback in development. An anonymous read still discloses this
 * deployment's PAPER posture, and plaintext would also let a network position substitute the
 * projection the app then renders as fact.
 */
function isSecureObservationEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch { return false; }
}

export function resolveObservationEndpoint(options: AnonymousObservationOptions = {}): string | null {
  const candidate = options.baseUrl?.trim()
    || getConfiguredPaperEndpoint()
    || getCanonicalCloudOrigin(options.environment ?? process.env)
    || "";
  if (!candidate) return null;
  const endpoint = normalizeEndpoint(candidate);
  return isSecureObservationEndpoint(endpoint) ? endpoint : null;
}

function readTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("PAPER observation timeout must be an integer in (0, 30000]");
  return timeoutMs;
}

/**
 * Fetches the PAPER projection without any credential.
 *
 * No Authorization header is ever attached, so this cannot leak a session token to an endpoint
 * that was never verified, and a server with anonymous observation disabled simply answers 401.
 */
export async function loadAnonymousPaperObservation(options: AnonymousObservationOptions = {}): Promise<AnonymousObservationResult> {
  const configured = resolveObservationEndpoint(options);
  if (configured == null) return Object.freeze({ status: "UNAVAILABLE", reason: "관측용 Cloud PAPER 주소가 설정되지 않았습니다." });

  let timeoutMs: number;
  try { timeoutMs = readTimeoutMs(options.timeoutMs); }
  catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER observation timeout is invalid." }); }

  const endpoint = new URL(`${configured}${OBSERVATION_PATH}`).href;
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const response = await (options.request ?? fetch)(endpoint, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        // accept only. Adding an authorization header here would defeat the point of the module.
        headers: { accept: "application/json" }
      });
      if (response.redirected === true) throw new Error("PAPER observation redirect is prohibited.");
      if (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint) throw new Error("PAPER observation final endpoint changed.");
      return response;
    })();
    const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => { controller.abort(); reject(new Error("PAPER observation request timed out.")); }, timeoutMs); });
    const response = await Promise.race([operation, timeout]);
    if (response.status === 401 || response.status === 403) {
      return Object.freeze({ status: "UNAVAILABLE", reason: "이 서버는 무인증 관측을 허용하지 않습니다. 설정에서 연결하세요." });
    }
    if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: `PAPER 관측을 사용할 수 없습니다 (${response.status}).` });
    const payload: unknown = await response.json();
    try {
      return Object.freeze({ status: "READY", snapshot: validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot) });
    } catch (error) {
      return Object.freeze({ status: "UNAVAILABLE", reason: describeProjectionRejection(error) });
    }
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER 관측 연결을 사용할 수 없습니다." });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
