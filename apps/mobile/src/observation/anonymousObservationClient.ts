import { validatePersonalPaperOperationsSnapshot, type PersonalPaperOperationsSnapshot } from "../../../../packages/contracts/src/personalPaperOperations";
import { getCanonicalCloudOrigin } from "../canonicalOrigin";
import { getConfiguredPaperEndpoint } from "../paperConnectionSession";
import { describeProjectionRejection } from "../personalPaperOperationsClient";

const OBSERVATION_PATH = "/api/paper-operations";

export type AnonymousObservationResult =
  | { readonly status: "READY"; readonly snapshot: PersonalPaperOperationsSnapshot }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface AnonymousObservationOptions {
  readonly baseUrl?: string;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  readonly environment?: Record<string, string | undefined>;
}

function resolveBaseUrl(options: AnonymousObservationOptions): string | null {
  const candidate = options.baseUrl?.trim() || getConfiguredPaperEndpoint() || getCanonicalCloudOrigin(options.environment ?? process.env) || "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return null;
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return candidate.replace(/\/+$/, "");
  } catch { return null; }
}

export function resolveObservationEndpoint(options: AnonymousObservationOptions = {}): string | null {
  return resolveBaseUrl(options);
}

export async function loadAnonymousPaperObservation(options: AnonymousObservationOptions = {}): Promise<AnonymousObservationResult> {
  const baseUrl = resolveBaseUrl(options);
  if (baseUrl == null) return { status: "UNAVAILABLE", reason: "관측용 Cloud PAPER 주소가 설정되지 않았습니다." };
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) return { status: "UNAVAILABLE", reason: "PAPER observation timeout is invalid." };
  const endpoint = new URL(`${baseUrl}${OBSERVATION_PATH}`).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.request ?? fetch)(endpoint, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
    if (response.redirected || (response.url && new URL(response.url).href !== endpoint)) return { status: "UNAVAILABLE", reason: "PAPER observation endpoint changed." };
    if (response.status === 401 || response.status === 403) return { status: "UNAVAILABLE", reason: "이 서버는 무인증 관측을 허용하지 않습니다. 설정에서 연결하세요." };
    if (!response.ok) return { status: "UNAVAILABLE", reason: `PAPER 관측을 사용할 수 없습니다 (${response.status}).` };
    try {
      const snapshot = validatePersonalPaperOperationsSnapshot(await response.json() as PersonalPaperOperationsSnapshot);
      return { status: "READY", snapshot };
    } catch (error) {
      return { status: "UNAVAILABLE", reason: describeProjectionRejection(error) };
    }
  } catch (error) {
    return { status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER 관측 연결을 사용할 수 없습니다." };
  } finally { clearTimeout(timer); }
}
