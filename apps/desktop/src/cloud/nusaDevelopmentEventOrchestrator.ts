import {
  createNusaDevelopmentQueue,
  type NusaDevelopmentQueue,
  type NusaDevelopmentWorkItem,
} from "./nusaDevelopmentControlPlane";

export type NusaDevelopmentEventType =
  | "IMPLEMENTATION_STARTED"
  | "VALIDATION_STARTED"
  | "CI_STARTED"
  | "CI_SUCCEEDED"
  | "CI_FAILED"
  | "AUDIT_SUCCEEDED"
  | "AUDIT_FAILED"
  | "PR_MERGED"
  | "HUMAN_BLOCKED";

export interface NusaDevelopmentEvent {
  readonly eventId: string;
  readonly type: NusaDevelopmentEventType;
  readonly workId: string;
  readonly expectedRevision: number;
  readonly occurredAt: number;
  readonly reason?: string;
}

export interface NusaDevelopmentEventOrchestratorState {
  readonly queue: NusaDevelopmentQueue;
  readonly processedEventIds: readonly string[];
  readonly processedEventFingerprints: Readonly<Record<string, string>>;
}

export type ApplyNusaDevelopmentEventResult =
  | {
      readonly status: "APPLIED" | "IDEMPOTENT_REPLAY";
      readonly state: NusaDevelopmentEventOrchestratorState;
      readonly item: NusaDevelopmentWorkItem;
    }
  | {
      readonly status: "REVISION_CONFLICT" | "WORK_NOT_FOUND" | "INVALID_TRANSITION" | "EVENT_ID_CONFLICT";
      readonly state: NusaDevelopmentEventOrchestratorState;
      readonly item: NusaDevelopmentWorkItem | null;
    };

const TRANSITIONS: Readonly<Record<NusaDevelopmentEventType, Readonly<Record<string, NusaDevelopmentWorkItem["state"]>>>> = Object.freeze({
  IMPLEMENTATION_STARTED: Object.freeze({ CLAIMED: "IMPLEMENTING" }),
  VALIDATION_STARTED: Object.freeze({ IMPLEMENTING: "VALIDATING" }),
  CI_STARTED: Object.freeze({ VALIDATING: "CI" }),
  CI_SUCCEEDED: Object.freeze({ CI: "AUDIT" }),
  CI_FAILED: Object.freeze({ CI: "IMPLEMENTING" }),
  AUDIT_SUCCEEDED: Object.freeze({ AUDIT: "MERGE_READY" }),
  AUDIT_FAILED: Object.freeze({ AUDIT: "IMPLEMENTING" }),
  PR_MERGED: Object.freeze({ MERGE_READY: "MERGED" }),
  HUMAN_BLOCKED: Object.freeze({
    READY: "BLOCKED_HUMAN",
    CLAIMED: "BLOCKED_HUMAN",
    IMPLEMENTING: "BLOCKED_HUMAN",
    VALIDATING: "BLOCKED_HUMAN",
    CI: "BLOCKED_HUMAN",
    AUDIT: "BLOCKED_HUMAN",
    MERGE_READY: "BLOCKED_HUMAN",
  }),
});

const EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(TRANSITIONS));
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const isCanonicalTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function validateEvent(event: NusaDevelopmentEvent): void {
  if (typeof event !== "object" || event == null) throw new Error("EVENT_INVALID");
  if (typeof event.eventId !== "string" || !SAFE_ID.test(event.eventId)) throw new Error("EVENT_ID_INVALID");
  if (typeof event.workId !== "string" || !SAFE_ID.test(event.workId)) throw new Error("EVENT_WORK_ID_INVALID");
  if (!EVENT_TYPES.has(event.type)) throw new Error("EVENT_TYPE_INVALID");
  if (!isCanonicalTimestamp(event.expectedRevision)) throw new Error("EVENT_EXPECTED_REVISION_INVALID");
  if (!isCanonicalTimestamp(event.occurredAt)) throw new Error("EVENT_OCCURRED_AT_INVALID");
  if (event.reason !== undefined && (typeof event.reason !== "string" || event.reason.length > 160)) throw new Error("EVENT_REASON_INVALID");
}

function eventFingerprint(event: NusaDevelopmentEvent): string {
  return JSON.stringify([
    event.type,
    event.workId,
    event.expectedRevision,
    event.occurredAt,
    event.reason ?? null,
  ]);
}

function freezeState(
  queue: NusaDevelopmentQueue,
  processedEventFingerprints: Readonly<Record<string, string>>,
): NusaDevelopmentEventOrchestratorState {
  const fingerprints = Object.freeze({ ...processedEventFingerprints });
  return Object.freeze({
    queue,
    // Object insertion order depends on delivery order. Keep this projection
    // canonical so a replayed history has a stable serialized representation.
    processedEventIds: Object.freeze(Object.keys(fingerprints).sort()),
    processedEventFingerprints: fingerprints,
  });
}

export function createNusaDevelopmentEventOrchestratorState(
  queue: NusaDevelopmentQueue,
  processedEvents: readonly NusaDevelopmentEvent[] = [],
): NusaDevelopmentEventOrchestratorState {
  const fingerprints: Record<string, string> = {};
  for (const event of processedEvents) {
    validateEvent(event);
    if (fingerprints[event.eventId]) throw new Error(`EVENT_ID_DUPLICATE:${event.eventId}`);
    fingerprints[event.eventId] = eventFingerprint(event);
  }
  return freezeState(queue, fingerprints);
}

function nextActionFor(event: NusaDevelopmentEvent): string {
  switch (event.type) {
    case "IMPLEMENTATION_STARTED": return "implement";
    case "VALIDATION_STARTED": return "validate";
    case "CI_STARTED": return "await-exact-head-ci";
    case "CI_SUCCEEDED": return "audit";
    case "CI_FAILED": return "repair-ci-failure";
    case "AUDIT_SUCCEEDED": return "release";
    case "AUDIT_FAILED": return "repair-audit-failure";
    case "PR_MERGED": return "done";
    case "HUMAN_BLOCKED": return event.reason?.trim() ? `human-blocked:${event.reason.trim()}` : "human-blocked";
  }
}

export function applyNusaDevelopmentEvent(
  state: NusaDevelopmentEventOrchestratorState,
  event: NusaDevelopmentEvent,
): ApplyNusaDevelopmentEventResult {
  validateEvent(event);

  const fingerprint = eventFingerprint(event);
  const processedFingerprint = state.processedEventFingerprints[event.eventId];
  if (processedFingerprint !== undefined) {
    const item = state.queue.items.find((candidate) => candidate.id === event.workId) ?? null;
    if (processedFingerprint !== fingerprint) {
      return { status: "EVENT_ID_CONFLICT", state, item };
    }
    return item
      ? { status: "IDEMPOTENT_REPLAY", state, item }
      : { status: "WORK_NOT_FOUND", state, item: null };
  }

  if (event.expectedRevision !== state.queue.revision) {
    return { status: "REVISION_CONFLICT", state, item: null };
  }

  const current = state.queue.items.find((candidate) => candidate.id === event.workId) ?? null;
  if (!current) return { status: "WORK_NOT_FOUND", state, item: null };

  const target = TRANSITIONS[event.type][current.state];
  if (!target) return { status: "INVALID_TRANSITION", state, item: current };

  const updated: NusaDevelopmentWorkItem = Object.freeze({
    ...current,
    state: target,
    nextAction: nextActionFor(event),
    claim: event.type === "PR_MERGED" || event.type === "HUMAN_BLOCKED" ? null : current.claim,
  });
  const queue = createNusaDevelopmentQueue(
    state.queue.items.map((item) => item.id === current.id ? updated : item),
    state.queue.revision + 1,
  );
  const next = freezeState(queue, {
    ...state.processedEventFingerprints,
    [event.eventId]: fingerprint,
  });
  return { status: "APPLIED", state: next, item: updated };
}

/**
 * Reconstructs a control-plane state from a canonical event history. This is
 * deliberately a pure replay helper: it cannot claim work, execute code, or
 * mutate GitHub state. Any malformed, out-of-order, or contradictory record
 * fails closed instead of producing a partial queue.
 */
export function replayNusaDevelopmentEvents(
  initialQueue: NusaDevelopmentQueue,
  events: readonly NusaDevelopmentEvent[],
): NusaDevelopmentEventOrchestratorState {
  let state = createNusaDevelopmentEventOrchestratorState(initialQueue);
  let previousOccurredAt: number | null = null;
  for (const event of events) {
    validateEvent(event);
    if (previousOccurredAt !== null && event.occurredAt < previousOccurredAt) throw new Error("EVENT_REPLAY_CHRONOLOGY_INVALID");
    const result = applyNusaDevelopmentEvent(state, event);
    if (result.status !== "APPLIED" && result.status !== "IDEMPOTENT_REPLAY") throw new Error(`EVENT_REPLAY_${result.status}`);
    state = result.state;
    previousOccurredAt = event.occurredAt;
  }
  return state;
}
