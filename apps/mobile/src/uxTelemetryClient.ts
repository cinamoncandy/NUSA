/**
 * Client-side emitter for the UX telemetry HTTP endpoint (apps/cloud/src/uxTelemetryHttp.ts).
 *
 * Follows the same shape as personalPaperOperationsClient.ts: injectable fetch/timeout, an async
 * credential provider, and a secure-endpoint check. Two things are different on purpose:
 *
 * - Telemetry emission is best-effort and fire-and-forget. It must never throw, never block the
 *   caller, and never surface a telemetry failure as an app-visible error -- a dropped UX event is
 *   not something the user should ever see or be delayed by.
 * - `enabled` is a required, explicit boolean the caller must pass from its own settings state.
 *   This module invents no consent mechanism of its own and defaults to nothing: whether telemetry
 *   is on is entirely the caller's decision, matching the charter's "명시적 설정 범위에서만" rule.
 *
 * The event's ownerPrincipalId is set to a placeholder here because the server
 * (handleUxTelemetryEventHttp) always overwrites it with the authenticated principal anyway -- the
 * client-supplied value is never trusted or used.
 */
import type { UxTelemetryEventKind } from "../../../packages/contracts/src/uxTelemetryEvent";

export type UxTelemetryCredentialProvider = () => Promise<string | null>;

export interface UxTelemetryClientOptions {
  readonly baseUrl: string;
  readonly credentialProvider: UxTelemetryCredentialProvider;
  readonly sessionId: string;
  readonly enabled: boolean;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface EmitUxTelemetryEventInput {
  readonly kind: UxTelemetryEventKind;
  readonly screenId: string;
  readonly taskId?: string;
  readonly actionId?: string;
  readonly reasonCode?: string;
  readonly navigationDepth?: number;
}

export type UxTelemetryEmitResult = "SENT" | "SKIPPED_DISABLED" | "SKIPPED_NO_CREDENTIAL" | "SKIPPED_INSECURE_ENDPOINT" | "SKIPPED_FAILED";

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isSecureTelemetryEndpoint(baseUrl: string): boolean {
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
  const timeoutMs = value ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15_000) return 5_000;
  return timeoutMs;
}

let eventSequence = 0;
function nextEventId(sessionId: string): string {
  eventSequence += 1;
  return `${sessionId}:${Date.now()}:${eventSequence}`;
}

/**
 * Emits one UX telemetry event, best-effort. Never throws; every failure path returns a
 * SKIPPED_* result instead so a caller can log or ignore it without special-casing exceptions.
 */
export async function emitUxTelemetryEvent(
  event: EmitUxTelemetryEventInput,
  options: UxTelemetryClientOptions,
): Promise<UxTelemetryEmitResult> {
  if (!options.enabled) return "SKIPPED_DISABLED";

  const baseUrl = normalizeEndpoint(options.baseUrl);
  if (!isSecureTelemetryEndpoint(baseUrl)) return "SKIPPED_INSECURE_ENDPOINT";

  let token: string | null;
  try {
    token = await options.credentialProvider();
  } catch {
    return "SKIPPED_NO_CREDENTIAL";
  }
  if (!token) return "SKIPPED_NO_CREDENTIAL";

  const doFetch = options.request ?? fetch;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeoutMs = readTimeoutMs(options.timeoutMs);
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await doFetch(`${baseUrl}/api/ux-telemetry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        eventId: nextEventId(options.sessionId),
        kind: event.kind,
        sessionId: options.sessionId,
        ownerPrincipalId: "self",
        screenId: event.screenId,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
        ...(event.actionId === undefined ? {} : { actionId: event.actionId }),
        ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
        ...(event.navigationDepth === undefined ? {} : { navigationDepth: event.navigationDepth }),
        occurredAtMs: Date.now(),
      }),
      signal: controller?.signal,
    });
    return response.ok || response.status === 202 ? "SENT" : "SKIPPED_FAILED";
  } catch {
    return "SKIPPED_FAILED";
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
