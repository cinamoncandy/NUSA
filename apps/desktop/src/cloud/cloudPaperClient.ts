import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../../packages/contracts/src/personalPaperOperations";
import {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult,
  type PersonalPaperOrderCommand,
  type PersonalPaperOrderCommandResult
} from "../../../../packages/contracts/src/personalPaperOrderCommand";
import type { DesktopCloudSessionClient, DesktopCloudSessionLease } from "./desktopCloudSessionClient";

export type CloudPaperClientResult<T> =
  | { readonly status: "READY"; readonly value: T }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface CloudPaperClientOptions {
  readonly session: DesktopCloudSessionClient;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}

function readTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error("Cloud PAPER timeout must be an integer in (0, 30000].");
  return timeoutMs;
}

function errorReason(payload: unknown, fallback: string): string {
  if (payload != null && typeof payload === "object" && "error" in payload) {
    const message = String((payload as { readonly error?: unknown }).error ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

async function requestBoundJson(
  options: CloudPaperClientOptions,
  lease: DesktopCloudSessionLease,
  path: string,
  init: RequestInit
): Promise<{ readonly response: Response; readonly payload: unknown }> {
  const endpoint = new URL(path, `${lease.endpoint}/`).href;
  const controller = new AbortController();
  const timeoutMs = readTimeoutMs(options.timeoutMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const response = await (options.request ?? fetch)(endpoint, { ...init, redirect: "error", signal: controller.signal });
      if (response.redirected === true) throw new Error("Cloud PAPER redirect is prohibited.");
      if (typeof response.url === "string" && response.url && new URL(response.url).href !== endpoint) throw new Error("Cloud PAPER final endpoint changed.");
      const payload: unknown = await response.json().catch(() => null);
      return { response, payload };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new Error("Cloud PAPER request timed out."));
      }, timeoutMs);
    });
    const result = await Promise.race([operation, timeout]);
    if (!options.session.isCurrent(lease)) throw new Error("Cloud PAPER session changed while the request was in flight.");
    return result;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function acquireLease(options: CloudPaperClientOptions): Promise<DesktopCloudSessionLease | undefined> {
  if (options.session.snapshot().endpoint == null) return undefined;
  return options.session.lease();
}

/**
 * Desktop client for the canonical Cloud PAPER contract.
 * Access credentials are leased from the rotating Desktop secure session and never
 * persisted or exposed to the renderer. There is intentionally no local broker fallback.
 */
export class CloudPaperClient {
  public constructor(private readonly options: CloudPaperClientOptions) {
    readTimeoutMs(options.timeoutMs);
  }

  public async loadOperations(): Promise<CloudPaperClientResult<PersonalPaperOperationsSnapshot>> {
    try {
      const lease = await acquireLease(this.options);
      if (lease == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Cloud PAPER secure session is not configured." });
      const { response, payload } = await requestBoundJson(this.options, lease, "/api/paper-operations", {
        method: "GET",
        headers: { authorization: `Bearer ${lease.accessToken}`, accept: "application/json" }
      });
      if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: errorReason(payload, `Cloud PAPER operations unavailable (${response.status}).`) });
      try {
        return Object.freeze({ status: "READY", value: validatePersonalPaperOperationsSnapshot(payload as PersonalPaperOperationsSnapshot) });
      } catch {
        return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid or stale Cloud PAPER operations snapshot." });
      }
    } catch (error) {
      return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Cloud PAPER operations are unavailable." });
    }
  }

  public async submitOrder(command: PersonalPaperOrderCommand): Promise<CloudPaperClientResult<PersonalPaperOrderCommandResult>> {
    let validated: PersonalPaperOrderCommand;
    try { validated = validatePersonalPaperOrderCommand(command); }
    catch (error) { return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Cloud PAPER order command is invalid." }); }
    try {
      const lease = await acquireLease(this.options);
      if (lease == null) return Object.freeze({ status: "NOT_CONFIGURED", reason: "Cloud PAPER secure session is not configured." });
      const { response, payload } = await requestBoundJson(this.options, lease, "/api/paper-orders", {
        method: "POST",
        headers: {
          authorization: `Bearer ${lease.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": validated.idempotencyKey
        },
        body: JSON.stringify(validated)
      });
      if (!response.ok) return Object.freeze({ status: "UNAVAILABLE", reason: errorReason(payload, `Cloud PAPER order unavailable (${response.status}).`) });
      try {
        return Object.freeze({ status: "READY", value: validatePersonalPaperOrderCommandResult(payload as PersonalPaperOrderCommandResult, validated, Date.now()) });
      } catch {
        return Object.freeze({ status: "UNAVAILABLE", reason: "Invalid Cloud PAPER order result." });
      }
    } catch (error) {
      return Object.freeze({ status: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Cloud PAPER order is unavailable." });
    }
  }
}
