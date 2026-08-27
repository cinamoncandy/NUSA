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
}

export type ApplyNusaDevelopmentEventResult =
  | {
      readonly status: "APPLIED" | "IDEMPOTENT_REPLAY";
      readonly state: NusaDevelopmentEventOrchestratorState;
      readonly item: NusaDevelopmentWorkItem;
    }
  | {
      readonly status: "REVISION_CONFLICT" | "WORK_NOT_FOUND" | "INVALID_TRANSITION";
      readonly state: NusaDevelopmentEventOrchestratorState;
      readonly item: NusaDevelopmentWorkItem | null;
    };

const TRANSITIONS: Readonly<Record<NusaDevelopmentEventType, Readonly<Record<string, NusaDevelopmentWorkItem["state"]>>>> = Object.freeze({
  IMPLEMENTATION_STARTED: Object.freeze({ CLAIMED: "IMPLEMENTING" }),
  VALIDATION_STARTED: Object.freeze({ IMPLEMENTING: "VALIDATING" }),
  CI_STARTED: Object.freeze({ VALIDATING: "CI" }),
  CI_SUCCEEDED: Object.freeze({ CI: "MERGE_READY" }),
  CI_FAILED: Object.freeze({ CI: "IMPLEMENTING" }),
  PR_MERGED: Object.freeze({ MERGE_READY: "MERGED" }),
  HUMAN_BLOCKED: Object.freeze({
    READY: "BLOCKED_HUMAN",
    CLAIMED: "BLOCKED_HUMAN",
    IMPLEMENTING: "BLOCKED_HUMAN",
    VALIDATING: "BLOCKED_HUMAN",
    CI: "BLOCKED_HUMAN",
    MERGE_READY: "BLOCKED_HUMAN",
  }),
});

function freezeState(queue: NusaDevelopmentQueue, processedEventIds: readonly string[]): NusaDevelopmentEventOrchestratorState {
  return Object.freeze({
    queue,
    processedEventIds: Object.freeze([...processedEventIds]),
  });
}

export function createNusaDevelopmentEventOrchestratorState(
  queue: NusaDevelopmentQueue,
  processedEventIds: readonly string[] = [],
): NusaDevelopmentEventOrchestratorState {
  const ids = new Set<string>();
  for (const eventId of processedEventIds) {
    if (!eventId.trim()) throw new Error("EVENT_ID_REQUIRED");
    if (ids.has(eventId)) throw new Error(`EVENT_ID_DUPLICATE:${eventId}`);
    ids.add(eventId);
  }
  return freezeState(queue, processedEventIds);
}

function nextActionFor(event: NusaDevelopmentEvent): string {
  switch (event.type) {
    case "IMPLEMENTATION_STARTED": return "implement";
    case "VALIDATION_STARTED": return "validate";
    case "CI_STARTED": return "await-exact-head-ci";
    case "CI_SUCCEEDED": return "merge";
    case "CI_FAILED": return "repair-ci-failure";
    case "PR_MERGED": return "done";
    case "HUMAN_BLOCKED": return event.reason?.trim() ? `human-blocked:${event.reason.trim()}` : "human-blocked";
  }
}

export function applyNusaDevelopmentEvent(
  state: NusaDevelopmentEventOrchestratorState,
  event: NusaDevelopmentEvent,
): ApplyNusaDevelopmentEventResult {
  if (!event.eventId.trim()) throw new Error("EVENT_ID_REQUIRED");
  if (!event.workId.trim()) throw new Error("EVENT_WORK_ID_REQUIRED");
  if (!Number.isFinite(event.occurredAt)) throw new Error("EVENT_OCCURRED_AT_INVALID");

  const replay = state.processedEventIds.includes(event.eventId);
  if (replay) {
    const item = state.queue.items.find((candidate) => candidate.id === event.workId) ?? null;
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
  const next = freezeState(queue, [...state.processedEventIds, event.eventId]);
  return { status: "APPLIED", state: next, item: updated };
}
