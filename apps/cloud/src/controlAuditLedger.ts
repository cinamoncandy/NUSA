import { createHash } from "node:crypto";
import { ControlAuditEvent } from "../../../packages/contracts/src/controlPlane";

export interface ControlAuditRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: ControlAuditEvent;
  readonly hash: string;
}

export interface ReplayedControlState {
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly killSwitchActive: boolean;
  readonly processedCommandIds: ReadonlySet<string>;
  readonly lastDecidedAt?: number;
  readonly ledgerHash: string;
}

const GENESIS_HASH = "0".repeat(64);

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
};

const assertTimestamp = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
};

const canonicalEvent = (event: ControlAuditEvent): string => JSON.stringify({
  cancelOpenOrders: event.cancelOpenOrders,
  commandId: event.commandId,
  decidedAt: event.decidedAt,
  deviceId: event.deviceId,
  reason: event.reason,
  resultingMode: event.resultingMode,
  status: event.status,
  type: event.type,
  userId: event.userId
});

const calculateRecordHash = (
  sequence: number,
  previousHash: string,
  event: ControlAuditEvent
): string => createHash("sha256")
  .update(`${sequence}\n${previousHash}\n${canonicalEvent(event)}`, "utf8")
  .digest("hex");

const validateEvent = (event: ControlAuditEvent): ControlAuditEvent => {
  assertText(event.commandId, "event.commandId");
  assertText(event.userId, "event.userId");
  assertText(event.deviceId, "event.deviceId");
  assertText(event.reason, "event.reason");
  assertTimestamp(event.decidedAt, "event.decidedAt");
  if (event.type === "EMERGENCY_STOP" && event.status === "ACCEPTED" && !event.cancelOpenOrders) {
    throw new Error("accepted emergency stop must request open-order cancellation");
  }
  if (event.type !== "EMERGENCY_STOP" && event.cancelOpenOrders) {
    throw new Error("only emergency stop may request open-order cancellation");
  }
  return Object.freeze({
    ...event,
    commandId: event.commandId.trim(),
    userId: event.userId.trim(),
    deviceId: event.deviceId.trim(),
    reason: event.reason.trim()
  });
};

export const appendControlAuditEvent = (
  records: readonly ControlAuditRecord[],
  event: ControlAuditEvent
): readonly ControlAuditRecord[] => {
  replayControlAuditLedger(records);
  const normalized = validateEvent(event);
  const sequence = records.length + 1;
  const previousHash = records.length === 0 ? GENESIS_HASH : records[records.length - 1].hash;
  const record = Object.freeze({
    sequence,
    previousHash,
    event: normalized,
    hash: calculateRecordHash(sequence, previousHash, normalized)
  });
  const nextRecords = Object.freeze([...records, record]);
  replayControlAuditLedger(nextRecords);
  return nextRecords;
};

export const replayControlAuditLedger = (
  records: readonly ControlAuditRecord[]
): ReplayedControlState => {
  let expectedPreviousHash = GENESIS_HASH;
  let lastDecidedAt: number | undefined;
  let mode: ReplayedControlState["mode"] = "STOPPED";
  let killSwitchActive = false;
  const processed = new Set<string>();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence) {
      throw new Error(`control audit sequence mismatch at ${expectedSequence}`);
    }
    if (record.previousHash !== expectedPreviousHash) {
      throw new Error(`control audit previous hash mismatch at ${expectedSequence}`);
    }
    const event = validateEvent(record.event);
    const expectedHash = calculateRecordHash(record.sequence, record.previousHash, event);
    if (record.hash !== expectedHash) {
      throw new Error(`control audit hash mismatch at ${expectedSequence}`);
    }
    if (lastDecidedAt !== undefined && event.decidedAt < lastDecidedAt) {
      throw new Error("control audit timestamps must be non-decreasing");
    }

    const alreadyProcessed = processed.has(event.commandId);
    if (event.status === "DUPLICATE") {
      if (!alreadyProcessed) {
        throw new Error("duplicate audit event has no prior command decision");
      }
    } else {
      if (alreadyProcessed) {
        throw new Error(`command decided more than once: ${event.commandId}`);
      }
      processed.add(event.commandId);
    }

    if (event.status === "ACCEPTED") {
      switch (event.type) {
        case "PAUSE":
          mode = "STOPPED";
          break;
        case "EMERGENCY_STOP":
          mode = "STOPPED";
          killSwitchActive = true;
          break;
        case "RESUME_PAPER":
          if (killSwitchActive) {
            throw new Error("paper resume cannot follow an active kill switch");
          }
          mode = "PAPER";
          break;
        default: {
          const exhaustive: never = event.type;
          throw new Error(`unsupported command type: ${exhaustive}`);
        }
      }
      if (event.resultingMode !== mode) {
        throw new Error(`resulting mode mismatch at ${expectedSequence}`);
      }
    }

    expectedPreviousHash = record.hash;
    lastDecidedAt = event.decidedAt;
  }

  return Object.freeze({
    mode,
    killSwitchActive,
    processedCommandIds: processed,
    lastDecidedAt,
    ledgerHash: expectedPreviousHash
  });
};
