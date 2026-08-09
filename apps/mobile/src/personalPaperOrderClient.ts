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

export async function submitPersonalPaperOrder(
  options: PersonalPaperOrderClientOptions,
  command: PersonalPaperOrderCommand
): Promise<PersonalPaperOrderSubmitResult> {
  let validated: PersonalPaperOrderCommand;
  try {
    validated = validatePersonalPaperOrderCommand(command);
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order command is invalid." });
  }

  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!isSecureEndpoint(baseUrl)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must use HTTPS unless it is loopback-only." });

  try {
    const response = await (options.request ?? fetch)(`${baseUrl}/api/paper-orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.trim()}`,
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": validated.idempotencyKey
      },
      body: JSON.stringify(validated)
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = payload != null && typeof payload === "object" && "error" in payload ? String((payload as { readonly error?: unknown }).error ?? "") : "";
      return Object.freeze({ status: "UNAVAILABLE", reason: reason || `PAPER order unavailable (${response.status}).` });
    }
    const result = validatePersonalPaperOrderCommandResult(payload as PersonalPaperOrderCommandResult);
    return Object.freeze({ status: "READY", result });
  } catch (error) {
    return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order connection is unavailable." });
  }
}
