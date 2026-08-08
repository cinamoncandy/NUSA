import { createHash } from "node:crypto";

export type P0AlertEventType = "OPENED" | "RESOLVED";

export interface P0AlertEvent {
  readonly eventId: string;
  readonly incidentId: string;
  readonly type: P0AlertEventType;
  readonly occurredAt: number;
  readonly reason: string;
}

export interface P0AlertRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: P0AlertEvent;
  readonly hash: string;
}

export interface ReplayedP0AlertState {
  readonly openP0: boolean;
  readonly openIncidentIds: readonly string[];
  readonly ledgerHash: string;
  readonly lastOccurredAt?: number;
}

const GENESIS_HASH = "0".repeat(64);

const assertText = (value: string, field: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must not be empty`);
};

const assertTimestamp = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("event.occurredAt must be a non-negative safe integer");
};

const normalizeEvent = (event: P0AlertEvent): P0AlertEvent => {
  assertText(event.eventId, "event.eventId");
  assertText(event.incidentId, "event.incidentId");
  assertText(event.reason, "event.reason");
  assertTimestamp(event.occurredAt);
  if (event.type !== "OPENED" && event.type !== "RESOLVED") throw new Error("event.type is invalid");
  return Object.freeze({
    eventId: event.eventId.trim(),
    incidentId: event.incidentId.trim(),
    type: event.type,
    occurredAt: event.occurredAt,
    reason: event.reason.trim()
  });
};

const canonicalEvent = (event: P0AlertEvent): string => JSON.stringify({
  eventId: event.eventId,
  incidentId: event.incidentId,
  occurredAt: event.occurredAt,
  reason: event.reason,
  type: event.type
});

const calculateRecordHash = (sequence: number, previousHash: string, event: P0AlertEvent): string => createHash("sha256")
  .update(`${sequence}\n${previousHash}\n${canonicalEvent(event)}`, "utf8")
  .digest("hex");

export function replayP0AlertLedger(records: readonly P0AlertRecord[]): ReplayedP0AlertState {
  let expectedPreviousHash = GENESIS_HASH;
  let lastOccurredAt: number | undefined;
  const eventIds = new Set<string>();
  const openIncidents = new Set<string>();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence) throw new Error(`P0 alert sequence mismatch at ${expectedSequence}`);
    if (record.previousHash !== expectedPreviousHash) throw new Error(`P0 alert previous hash mismatch at ${expectedSequence}`);
    const event = normalizeEvent(record.event);
    const expectedHash = calculateRecordHash(record.sequence, record.previousHash, event);
    if (record.hash !== expectedHash) throw new Error(`P0 alert hash mismatch at ${expectedSequence}`);
    if (lastOccurredAt !== undefined && event.occurredAt < lastOccurredAt) throw new Error("P0 alert timestamps must be non-decreasing");
    if (eventIds.has(event.eventId)) throw new Error(`P0 alert event duplicated: ${event.eventId}`);
    eventIds.add(event.eventId);

    if (event.type === "OPENED") {
      if (openIncidents.has(event.incidentId)) throw new Error(`P0 incident already open: ${event.incidentId}`);
      openIncidents.add(event.incidentId);
    } else {
      if (!openIncidents.has(event.incidentId)) throw new Error(`P0 incident is not open: ${event.incidentId}`);
      openIncidents.delete(event.incidentId);
    }

    expectedPreviousHash = record.hash;
    lastOccurredAt = event.occurredAt;
  }

  const openIncidentIds = Object.freeze([...openIncidents].sort());
  return Object.freeze({
    openP0: openIncidentIds.length > 0,
    openIncidentIds,
    ledgerHash: expectedPreviousHash,
    ...(lastOccurredAt === undefined ? {} : { lastOccurredAt })
  });
}

export function appendP0AlertEvent(records: readonly P0AlertRecord[], event: P0AlertEvent): readonly P0AlertRecord[] {
  replayP0AlertLedger(records);
  const normalized = normalizeEvent(event);
  const sequence = records.length + 1;
  const previousHash = records.length === 0 ? GENESIS_HASH : records[records.length - 1].hash;
  const record: P0AlertRecord = Object.freeze({
    sequence,
    previousHash,
    event: normalized,
    hash: calculateRecordHash(sequence, previousHash, normalized)
  });
  const next = Object.freeze([...records, record]);
  replayP0AlertLedger(next);
  return next;
}
