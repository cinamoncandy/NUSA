import {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult,
  type PersonalPaperOrderCommand,
  type PersonalPaperOrderCommandResult
} from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

export interface PersonalPaperOrderClientOptions { readonly baseUrl: string; readonly credentialProvider: DashboardCredentialProvider; readonly request?: typeof fetch; readonly timeoutMs?: number; }
export type PersonalPaperOrderSubmitResult = { readonly status: "READY"; readonly result: PersonalPaperOrderCommandResult } | { readonly status: "NOT_CONFIGURED"; readonly reason: string } | { readonly status: "UNAVAILABLE"; readonly reason: string };
export type PersonalPaperOrderDraftCommand = Omit<PersonalPaperOrderCommand, "idempotencyKey">;

/** Keeps ambiguous PAPER submissions bound to their original keys until definitive results arrive. */
export class PersonalPaperOrderRetryIdentity {
  private readonly pendingByFingerprint = new Map<string, string>();
  private static readonly MAX_PENDING = 16;

  public acquire(fingerprintValue: string, createKey: () => string): string {
    const fingerprint = fingerprintValue.trim();
    if (!fingerprint) throw new Error("PAPER order retry fingerprint is required.");
    const prior = this.pendingByFingerprint.get(fingerprint);
    if (prior != null) return prior;
    if (this.pendingByFingerprint.size >= PersonalPaperOrderRetryIdentity.MAX_PENDING) throw new Error("Too many unresolved PAPER order submissions.");
    const idempotencyKey = createKey().trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(idempotencyKey)) throw new Error("PAPER order idempotency key is invalid.");
    this.pendingByFingerprint.set(fingerprint, idempotencyKey);
    return idempotencyKey;
  }

  public settle(idempotencyKey: string): void {
    for (const [fingerprint, pendingKey] of this.pendingByFingerprint) {
      if (pendingKey === idempotencyKey) { this.pendingByFingerprint.delete(fingerprint); return; }
    }
  }
}

function isSecureEndpoint(baseUrl: string): boolean { try { const url = new URL(baseUrl); if (url.username || url.password) return false; if (url.protocol === "https:") return true; if (url.protocol !== "http:") return false; const host = url.hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; } catch { return false; } }
function readTimeoutMs(value: number | undefined): number { const timeoutMs = value ?? 10_000; if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("PAPER order timeout must be an integer in (0, 30000]"); return timeoutMs; }

export async function submitPersonalPaperOrder(options: PersonalPaperOrderClientOptions, command: PersonalPaperOrderCommand): Promise<PersonalPaperOrderSubmitResult> {
  let validated: PersonalPaperOrderCommand; let timeoutMs: number;
  try { validated = validatePersonalPaperOrderCommand(command); timeoutMs = readTimeoutMs(options.timeoutMs); } catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order command is invalid." }); }

  // PAPER order authority is bound only to the Settings-configured, process-locally verified
  // endpoint. The legacy caller baseUrl is intentionally not an authority input.
  const configured = getConfiguredPaperEndpoint();
  if (configured == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint is not configured. Open Settings and save the Cloud endpoint." });
  if (!isPaperConnectionVerified(configured)) return Object.freeze({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified in Settings before an order credential can be used." });
  if (!isSecureEndpoint(configured)) return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER credential will not be sent over insecure remote HTTP." });

  const token = await options.credentialProvider();
  if (token == null || !token.trim()) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Secure dashboard credential is not configured." });
  const requestToken = token.trim();
  const endpoint = new URL(`${configured}/api/paper-orders`).href;
  const controller = new AbortController(); let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const response = await (options.request ?? fetch)(endpoint, { method: "POST", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${requestToken}`, accept: "application/json", "content-type": "application/json", "idempotency-key": validated.idempotencyKey }, body: JSON.stringify(validated) });
      if (response.redirected === true) throw new Error("PAPER order redirect is prohibited.");
      if (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint) throw new Error("PAPER order final endpoint changed.");
      const payload: unknown = await response.json().catch(() => null); return { response, payload };
    })();
    const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => { controller.abort(); reject(new Error("PAPER order request timed out.")); }, timeoutMs); });
    const { response, payload } = await Promise.race([operation, timeout]);
    const currentToken = await options.credentialProvider();
    const connectionStillCurrent = getConfiguredPaperEndpoint() === configured && isPaperConnectionVerified(configured) && currentToken != null && currentToken.trim() === requestToken;
    if (!connectionStillCurrent) return Object.freeze({ status: "UNAVAILABLE", reason: "PAPER connection changed while the order request was in flight." });
    if (!response.ok) { const reason = payload != null && typeof payload === "object" && "error" in payload ? String((payload as { readonly error?: unknown }).error ?? "") : ""; return Object.freeze({ status: "UNAVAILABLE", reason: reason || `PAPER order unavailable (${response.status}).` }); }
    return Object.freeze({ status: "READY", result: validatePersonalPaperOrderCommandResult(payload as PersonalPaperOrderCommandResult, validated, Date.now()) });
  } catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order connection is unavailable." }); }
  finally { if (timeoutHandle !== undefined) clearTimeout(timeoutHandle); }
}

export async function submitPersonalPaperOrderWithRetryIdentity(
  options: PersonalPaperOrderClientOptions,
  retryIdentity: PersonalPaperOrderRetryIdentity,
  fingerprint: string,
  createKey: () => string,
  command: PersonalPaperOrderDraftCommand
): Promise<PersonalPaperOrderSubmitResult> {
  let idempotencyKey: string;
  try { idempotencyKey = retryIdentity.acquire(fingerprint, createKey); }
  catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "PAPER order retry identity is invalid." }); }
  const result = await submitPersonalPaperOrder(options, Object.freeze({ ...command, idempotencyKey }));
  if (result.status === "READY") retryIdentity.settle(idempotencyKey);
  return result;
}