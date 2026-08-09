import {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult,
  type PersonalPaperOrderCommand,
  type PersonalPaperOrderCommandResult
} from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

export interface PersonalPaperOrderClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: DashboardCredentialProvider;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}

export type PersonalPaperOrderSubmitResult =
  | { readonly status: "READY"; readonly result: PersonalPaperOrderCommandResult }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

function isSecureEndpoint(baseUrl: string): boolean {
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

function readTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("PAPER order timeout must be an integer in (0, 30000]");
  return timeoutMs;
}

export async function submitPersonalPaperOrder(
  options: PersonalPaperOrderClientOptions,
  command: PersonalPaperOrderCommand
): Promise<PersonalPaperOrderSubmitResult> {
  let validated: PersonalPaperOrderCommand;
  let timeoutMs: number;
  try {
    validated = validatePersonalPaperOrderCommand(command);
    timeoutMs = readTimeoutMs(options.timeoutMs);
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order command is invalid." });
  }

  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!isSecureEndpoint(baseUrl)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must use HTTPS unless it is loopback-only." });

  const endpoint = new URL(`${baseUrl}/api/paper-orders`).href;
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = options.request ?? fetch;
    const operation = (async () => {
      const response = await request(endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token.trim()}`,
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": validated.idempotencyKey
        },
        body: JSON.stringify(validated)
      });
      if (response.redirected === true) throw new Error("PAPER order redirect is prohibited.");
      if (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint) throw new Error("PAPER order final endpoint changed.");
      const payload: unknown = await response.json().catch(() => null);
      return { response, payload };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new Error("PAPER order request timed out."));
      }, timeoutMs);
    });
    const { response, payload } = await Promise.race([operation, timeout]);
    if (!response.ok) {
      const reason = payload != null && typeof payload === "object" && "error" in payload ? String((payload as { readonly error?: unknown }).error ?? "") : "";
      return Object.freeze({ status: "UNAVAILABLE", reason: reason || `PAPER order unavailable (${response.status}).` });
    }
    const result = validatePersonalPaperOrderCommandResult(payload as PersonalPaperOrderCommandResult, validated);
    return Object.freeze({ status: "READY", result });
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order connection is unavailable." });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
