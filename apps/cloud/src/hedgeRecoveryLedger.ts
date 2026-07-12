import { createHash } from "node:crypto";
import type { HedgeState } from "./atomicHedgeCoordinator";

export type HedgeRecoveryAction = "FILL_UPDATED" | "CANCEL_REMAINING" | "COMPENSATE" | "ROLLBACK" | "KILL_SWITCH_RECOMMENDED" | "FAULTED";

export interface HedgeRecoveryEvent {
  readonly hedgeId: string;
  readonly action: HedgeRecoveryAction;
  readonly status: HedgeState;
  readonly actualDelta: number;
  readonly reason: string;
  readonly recordedAt: number;
}

export interface HedgeRecoveryRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: HedgeRecoveryEvent;
  readonly hash: string;
}

export interface ReplayedHedgeRecoveryState {
  readonly hedgeId?: string;
  readonly status?: HedgeState;
  readonly actualDelta: number;
  readonly killSwitchRecommended: boolean;
  readonly lastRecordedAt?: number;
  readonly ledgerHash: string;
}

const GENESIS_HASH = "0".repeat(64);
const allowed: Readonly<Record<HedgeState, readonly HedgeState[]>> = Object.freeze({
  PLANNED: ["SUBMITTING", "FAULTED"],
  SUBMITTING: ["PARTIALLY_HEDGED", "HEDGED", "FAULTED"],
  PARTIALLY_HEDGED: ["REBALANCING", "EXITING", "FAULTED"],
  HEDGED: ["REBALANCING", "EXITING", "FAULTED"],
  REBALANCING: ["HEDGED", "PARTIALLY_HEDGED", "EXITING", "FAULTED"],
  EXITING: ["CLOSED", "FAULTED"],
  CLOSED: [],
  FAULTED: []
});

const canonical = (event: HedgeRecoveryEvent): string => JSON.stringify({
  action: event.action,
  actualDelta: event.actualDelta,
  hedgeId: event.hedgeId,
  reason: event.reason,
  recordedAt: event.recordedAt,
  status: event.status
});

const hash = (sequence: number, previousHash: string, event: HedgeRecoveryEvent): string => createHash("sha256")
  .update(`${sequence}\n${previousHash}\n${canonical(event)}`, "utf8")
  .digest("hex");

const validateEvent = (event: HedgeRecoveryEvent): HedgeRecoveryEvent => {
  const hedgeId = event.hedgeId.trim();
  const reason = event.reason.trim();
  if (!hedgeId || !reason) throw new Error("hedge recovery event text fields are required");
  if (!Number.isFinite(event.actualDelta)) throw new Error("hedge recovery actualDelta is invalid");
  if (!Number.isSafeInteger(event.recordedAt) || event.recordedAt < 0) throw new Error("hedge recovery recordedAt is invalid");
  if (event.action === "KILL_SWITCH_RECOMMENDED" && event.status !== "FAULTED") throw new Error("kill-switch recommendation requires FAULTED status");
  return Object.freeze({ ...event, hedgeId, reason });
};

export function replayHedgeRecoveryLedger(records: readonly HedgeRecoveryRecord[]): ReplayedHedgeRecoveryState {
  let previousHash = GENESIS_HASH;
  let hedgeId: string | undefined;
  let status: HedgeState | undefined;
  let actualDelta = 0;
  let killSwitchRecommended = false;
  let lastRecordedAt: number | undefined;

  records.forEach((record, index) => {
    const sequence = index + 1;
    if (record.sequence !== sequence) throw new Error(`hedge recovery sequence mismatch at ${sequence}`);
    if (record.previousHash !== previousHash) throw new Error(`hedge recovery previous hash mismatch at ${sequence}`);
    const event = validateEvent(record.event);
    if (record.hash !== hash(sequence, previousHash, event)) throw new Error(`hedge recovery hash mismatch at ${sequence}`);
    if (hedgeId !== undefined && event.hedgeId !== hedgeId) throw new Error("hedge recovery ledger cannot mix hedge ids");
    if (lastRecordedAt !== undefined && event.recordedAt < lastRecordedAt) throw new Error("hedge recovery timestamps must be non-decreasing");
    if (status !== undefined && event.status !== status && !allowed[status].includes(event.status)) throw new Error(`invalid hedge transition: ${status} -> ${event.status}`);
    hedgeId = event.hedgeId;
    status = event.status;
    actualDelta = event.actualDelta;
    killSwitchRecommended ||= event.action === "KILL_SWITCH_RECOMMENDED";
    lastRecordedAt = event.recordedAt;
    previousHash = record.hash;
  });

  return Object.freeze({
    ...(hedgeId === undefined ? {} : { hedgeId }),
    ...(status === undefined ? {} : { status }),
    actualDelta,
    killSwitchRecommended,
    ...(lastRecordedAt === undefined ? {} : { lastRecordedAt }),
    ledgerHash: previousHash
  });
}

export function appendHedgeRecoveryEvent(records: readonly HedgeRecoveryRecord[], event: HedgeRecoveryEvent): readonly HedgeRecoveryRecord[] {
  replayHedgeRecoveryLedger(records);
  const normalized = validateEvent(event);
  const sequence = records.length + 1;
  const previousHash = records.length === 0 ? GENESIS_HASH : records[records.length - 1].hash;
  const record = Object.freeze({ sequence, previousHash, event: normalized, hash: hash(sequence, previousHash, normalized) });
  const next = Object.freeze([...records, record]);
  replayHedgeRecoveryLedger(next);
  return next;
}
