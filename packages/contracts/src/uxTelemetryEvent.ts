/**
 * UX telemetry event contract (NUSA governing charter sections 39-41: "사용자 편의 지속 연구").
 *
 * This is deliberately not free-form analytics. Every field is either a bounded enumeration or a
 * safe identifier pattern -- there is no field a client could use to smuggle in message text,
 * search queries, account numbers, or any other sensitive content. That is a structural
 * enforcement of "민감정보 몰래 추적 금지, 명시적 설정 범위에서만 개선": a screen, an action, and a
 * reason are always drawn from a closed identifier vocabulary the product already defines, never
 * arbitrary user input.
 */

export type UxTelemetryEventKind =
  | "SCREEN_VIEW"
  | "TAP"
  | "NAVIGATION_PUSH"
  | "NAVIGATION_POP"
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_ABANDONED"
  | "ERROR_SHOWN"
  | "ERROR_RECOVERED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_CANCELLED"
  | "APPROVAL_COMPLETED"
  | "SEARCH_USED"
  | "REPEAT_ACTION";

export const UX_TELEMETRY_EVENT_KINDS: readonly UxTelemetryEventKind[] = Object.freeze([
  "SCREEN_VIEW",
  "TAP",
  "NAVIGATION_PUSH",
  "NAVIGATION_POP",
  "TASK_STARTED",
  "TASK_COMPLETED",
  "TASK_ABANDONED",
  "ERROR_SHOWN",
  "ERROR_RECOVERED",
  "APPROVAL_REQUESTED",
  "APPROVAL_CANCELLED",
  "APPROVAL_COMPLETED",
  "SEARCH_USED",
  "REPEAT_ACTION",
]);

/**
 * A single UX telemetry event.
 *
 * `taskId`, `actionId`, `screenId`, and `reasonCode` are bounded identifiers the product defines
 * (e.g. screen names, button ids, closed reason codes) -- never end-user text.
 */
export interface UxTelemetryEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly kind: UxTelemetryEventKind;
  readonly sessionId: string;
  readonly ownerPrincipalId: string;
  readonly screenId: string;
  readonly taskId?: string;
  readonly actionId?: string;
  readonly reasonCode?: string;
  readonly navigationDepth?: number;
  readonly occurredAtMs: number;
}

export interface UxTelemetryEventValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function optionalSafeIdentifier(value: unknown): boolean {
  return value === undefined || safeIdentifier(value);
}

/**
 * Validates a UX telemetry event. Fails closed: anything not matching the exact contract
 * (including an unrecognized event kind, a non-enumerated identifier, or free-text-shaped input)
 * is rejected rather than silently accepted or best-effort coerced.
 */
export function validateUxTelemetryEvent(value: unknown): UxTelemetryEventValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["EVENT_INVALID"] };
  }
  const event = value as Record<string, unknown>;

  if (event.schemaVersion !== 1) errors.push("SCHEMA_VERSION_INVALID");
  if (typeof event.eventId !== "string" || !EVENT_ID.test(event.eventId)) errors.push("EVENT_ID_INVALID");
  if (typeof event.kind !== "string" || !UX_TELEMETRY_EVENT_KINDS.includes(event.kind as UxTelemetryEventKind)) errors.push("KIND_INVALID");
  if (!safeIdentifier(event.sessionId)) errors.push("SESSION_ID_INVALID");
  if (!safeIdentifier(event.ownerPrincipalId)) errors.push("OWNER_PRINCIPAL_ID_INVALID");
  if (!safeIdentifier(event.screenId)) errors.push("SCREEN_ID_INVALID");
  if (!optionalSafeIdentifier(event.taskId)) errors.push("TASK_ID_INVALID");
  if (!optionalSafeIdentifier(event.actionId)) errors.push("ACTION_ID_INVALID");
  if (!optionalSafeIdentifier(event.reasonCode)) errors.push("REASON_CODE_INVALID");
  if (event.navigationDepth !== undefined && (!Number.isSafeInteger(event.navigationDepth) || (event.navigationDepth as number) < 0)) {
    errors.push("NAVIGATION_DEPTH_INVALID");
  }
  if (!Number.isSafeInteger(event.occurredAtMs) || (event.occurredAtMs as number) < 0) errors.push("OCCURRED_AT_INVALID");

  const kind = event.kind as UxTelemetryEventKind;
  if (typeof kind === "string" && UX_TELEMETRY_EVENT_KINDS.includes(kind)) {
    if ((kind === "NAVIGATION_PUSH" || kind === "NAVIGATION_POP") && event.navigationDepth === undefined) {
      errors.push("NAVIGATION_DEPTH_REQUIRED");
    }
    if ((kind === "TASK_STARTED" || kind === "TASK_COMPLETED" || kind === "TASK_ABANDONED") && event.taskId === undefined) {
      errors.push("TASK_ID_REQUIRED");
    }
    if (kind === "TAP" && event.actionId === undefined) errors.push("ACTION_ID_REQUIRED");
  }

  return { valid: errors.length === 0, errors: Object.freeze([...new Set(errors)]) };
}

export function isValidUxTelemetryEvent(value: unknown): value is UxTelemetryEvent {
  return validateUxTelemetryEvent(value).valid;
}
