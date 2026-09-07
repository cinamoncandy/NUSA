/**
 * Durable UX telemetry event journal (NUSA governing charter section 39-41).
 *
 * This module only appends and reads already-validated events; it never accepts free-form input.
 * It grants no LIVE authority and performs no trading mutation, and it deliberately mirrors the
 * injectable-storage pattern already used by liveRuntimeSessionState.ts and
 * liveHumanApprovalConsumptionGate.ts, so a Durable Object, SQLite, or in-memory store can back it
 * without this module knowing which one.
 */
import { validateUxTelemetryEvent, type UxTelemetryEvent } from "../../../packages/contracts/src/uxTelemetryEvent";

export interface UxTelemetryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export type UxTelemetryAppendResult =
  | { readonly appended: true }
  | { readonly appended: false; readonly reason: "EVENT_INVALID" | "DUPLICATE_EVENT_ID" | "STORAGE_UNCERTAIN"; readonly errors?: readonly string[] };

export interface UxTelemetryReadResult {
  readonly ok: boolean;
  readonly events: readonly UxTelemetryEvent[];
}

const KEY_PREFIX = "ux-telemetry:v1:";
const MAX_EVENTS_PER_SESSION = 5_000;

function keyFor(ownerPrincipalId: string, sessionId: string): string {
  return `${KEY_PREFIX}${ownerPrincipalId}:${sessionId}`;
}

/**
 * Appends one validated event to the durable per-session event log. Event ids are deduplicated
 * within a session (a client retry never double-counts an event), and the log is bounded so a
 * single misbehaving client cannot grow it without limit.
 */
export async function appendUxTelemetryEvent(
  storage: UxTelemetryStorage,
  event: unknown,
): Promise<UxTelemetryAppendResult> {
  const validation = validateUxTelemetryEvent(event);
  if (!validation.valid) return { appended: false, reason: "EVENT_INVALID", errors: validation.errors };
  const validated = event as UxTelemetryEvent;

  try {
    const key = keyFor(validated.ownerPrincipalId, validated.sessionId);
    const existing = (await storage.get<readonly UxTelemetryEvent[]>(key)) ?? [];
    if (existing.some((entry) => entry.eventId === validated.eventId)) {
      return { appended: false, reason: "DUPLICATE_EVENT_ID" };
    }
    const next = [...existing, validated]
      .sort((a, b) => a.occurredAtMs - b.occurredAtMs)
      .slice(-MAX_EVENTS_PER_SESSION);
    await storage.put(key, next);
    return { appended: true };
  } catch {
    return { appended: false, reason: "STORAGE_UNCERTAIN" };
  }
}

/** Reads the durable event log for one owner/session pair, oldest first. Fails closed on read error. */
export async function readUxTelemetrySession(
  storage: UxTelemetryStorage,
  ownerPrincipalId: string,
  sessionId: string,
): Promise<UxTelemetryReadResult> {
  try {
    const events = (await storage.get<readonly UxTelemetryEvent[]>(keyFor(ownerPrincipalId, sessionId))) ?? [];
    return { ok: true, events };
  } catch {
    return { ok: false, events: [] };
  }
}
