import type { RuntimeEvent } from "./runtimeEventBus";
import { buildRuntimeReplay, type RuntimeReplay } from "./runtimeReplay";

export interface Explanation {
  readonly runId: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly evidenceEventIds: readonly string[];
}

export interface AuditFinding {
  readonly eventId: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly reason: string;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const explainRuntimeReplay = (replay: RuntimeReplay): Explanation => {
  const steps = replay.frames.map(({ event }) => `${event.type}: ${event.id}`);
  return freeze({
    runId: replay.runId,
    summary: `${replay.frames.length} immutable runtime events replayed`,
    steps: Object.freeze(steps),
    evidenceEventIds: Object.freeze(replay.frames.map(({ event }) => event.id))
  });
};

export const auditRuntimeEvents = (events: readonly RuntimeEvent[]): readonly AuditFinding[] => {
  if (events.length === 0) return Object.freeze([{ eventId: "", severity: "WARNING", reason: "NO_EVENTS" }]);
  const findings: AuditFinding[] = [];
  const ids = new Set<string>();
  let previous = -1;
  for (const event of events) {
    if (ids.has(event.id)) findings.push({ eventId: event.id, severity: "ERROR", reason: "DUPLICATE_EVENT_ID" });
    ids.add(event.id);
    if (event.occurredAt < previous) findings.push({ eventId: event.id, severity: "ERROR", reason: "EVENT_TIME_REGRESSION" });
    previous = event.occurredAt;
  }
  return Object.freeze(findings.map((finding) => freeze(finding)));
};

export const explainEvents = (events: readonly RuntimeEvent[]): Explanation => explainRuntimeReplay(buildRuntimeReplay(events));
