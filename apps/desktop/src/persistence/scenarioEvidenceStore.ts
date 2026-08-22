import type { DatabaseSync } from "node:sqlite";
import type { PaperScenarioEvent } from "../../../cloud/src/paperScenarioEvidenceLedger";

const SCENARIO_EVENT_TYPES = new Set([
  "SESSION_OBSERVED",
  "ORDER_COMPLETED",
  "REGIME_OBSERVED",
  "RECOVERY_COMPLETED",
  "DUPLICATE_ORDER_CHECKED",
  "FAULT_SCENARIO_PASSED"
]);

export function appendScenarioEvents(db: DatabaseSync, events: readonly PaperScenarioEvent[]): void {
  if (events.length === 0) throw new Error("scenario evidence batch must not be empty");

  let next = Number(
    (db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM desktop_paper_scenario_evidence").get() as { sequence: number }).sequence
  ) + 1;
  const insert = db.prepare(
    "INSERT INTO desktop_paper_scenario_evidence (sequence, event_id, event_json) VALUES (?, ?, ?)"
  );
  for (const event of events) {
    insert.run(next, event.eventId, JSON.stringify(event));
    next += 1;
  }
}

export function loadScenarioEvents(db: DatabaseSync): readonly PaperScenarioEvent[] {
  const rows = db.prepare(
    "SELECT sequence, event_id, event_json FROM desktop_paper_scenario_evidence ORDER BY sequence ASC"
  ).all() as Array<{ sequence: number; event_id: string; event_json: string }>;
  const events: PaperScenarioEvent[] = [];
  let expectedSequence = 1;
  const ids = new Set<string>();

  for (const row of rows) {
    if (row.sequence !== expectedSequence) throw new Error("scenario evidence sequence is not contiguous");
    expectedSequence += 1;
    if (ids.has(row.event_id)) throw new Error("duplicate scenario evidence event id");
    ids.add(row.event_id);

    let event: PaperScenarioEvent;
    try {
      event = JSON.parse(row.event_json) as PaperScenarioEvent;
    } catch (error) {
      throw new Error("scenario evidence event JSON is invalid", { cause: error });
    }
    if (event.eventId !== row.event_id) throw new Error("scenario evidence DB/event ID mismatch");
    if (!SCENARIO_EVENT_TYPES.has(event.type)) throw new Error("unsupported scenario evidence event type");
    if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("scenario evidence occurredAt is invalid");
    if (event.sessionId !== undefined && (!event.sessionId || typeof event.sessionId !== "string")) {
      throw new Error("scenario evidence sessionId is invalid");
    }
    if (event.scenario !== undefined && (!event.scenario || typeof event.scenario !== "string")) {
      throw new Error("scenario evidence scenario is invalid");
    }
    events.push(Object.freeze({ ...event }));
  }

  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.occurredAt < events[index - 1]!.occurredAt) {
      throw new Error("scenario evidence ordering is invalid");
    }
  }
  return Object.freeze(events);
}
