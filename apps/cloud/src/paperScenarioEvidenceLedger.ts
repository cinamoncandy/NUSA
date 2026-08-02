import { createHash } from "node:crypto";
import type { PaperScenarioEvent, PaperScenarioRecord } from "../../../packages/contracts/src/persistenceLedger";
export type { PaperScenarioEvent, PaperScenarioRecord, PaperScenarioEventType } from "../../../packages/contracts/src/persistenceLedger";
export interface PaperScenarioEvidenceSummary { readonly sessionCount: number; readonly completedOrderCount: number; readonly regimeCount: number; readonly recoveryPassCount: number; readonly duplicateOrderCheckCount: number; readonly passedFaultScenarios: readonly string[]; readonly firstOccurredAt: number | null; readonly lastOccurredAt: number | null; }

const ZERO = "0".repeat(64);
const freeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; };
const hash = (sequence: number, previousHash: string, event: PaperScenarioEvent): string => createHash("sha256").update(JSON.stringify({ sequence, previousHash, event })).digest("hex");
const validateEvent = (event: PaperScenarioEvent): void => { if (!event.eventId.trim() || !event.type) throw new Error("scenario event identity is required"); if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("scenario event timestamp is invalid"); if (event.sessionId !== undefined && !event.sessionId.trim()) throw new Error("scenario event session is invalid"); if (event.scenario !== undefined && !event.scenario.trim()) throw new Error("scenario event scenario is invalid"); };

export function appendPaperScenarioEvent(records: readonly PaperScenarioRecord[], event: PaperScenarioEvent): readonly PaperScenarioRecord[] {
  validateEvent(event); if (records.some((record) => record.event.eventId === event.eventId)) throw new Error("duplicate scenario event");
  const previous = records.at(-1); if (previous && event.occurredAt < previous.event.occurredAt) throw new Error("scenario event timestamps must be non-decreasing");
  const sequence = records.length + 1; const previousHash = previous?.hash ?? ZERO; const record = { sequence, previousHash, event: freeze({ ...event }), hash: hash(sequence, previousHash, event) };
  return freeze([...records, freeze(record)]);
}

export function replayPaperScenarioEvidence(records: readonly PaperScenarioRecord[]): PaperScenarioEvidenceSummary {
  let previousHash = ZERO; let previousAt = -1; const ids = new Set<string>(); const regimes = new Set<string>(); const faults = new Set<string>();
  let sessions = 0; let orders = 0; let recoveries = 0; let duplicateChecks = 0;
  for (const [index, record] of records.entries()) { if (record.sequence !== index + 1 || record.previousHash !== previousHash || record.hash !== hash(record.sequence, record.previousHash, record.event)) throw new Error("scenario evidence hash chain mismatch"); validateEvent(record.event); if (ids.has(record.event.eventId)) throw new Error("duplicate scenario event"); ids.add(record.event.eventId); if (record.event.occurredAt < previousAt) throw new Error("scenario event timestamps must be non-decreasing"); previousAt = record.event.occurredAt; previousHash = record.hash; if (record.event.type === "SESSION_OBSERVED") sessions++; if (record.event.type === "ORDER_COMPLETED") orders++; if (record.event.type === "REGIME_OBSERVED") regimes.add(record.event.scenario!); if (record.event.type === "RECOVERY_COMPLETED") recoveries++; if (record.event.type === "DUPLICATE_ORDER_CHECKED") duplicateChecks++; if (record.event.type === "FAULT_SCENARIO_PASSED") faults.add(record.event.scenario!); }
  return freeze({ sessionCount: sessions, completedOrderCount: orders, regimeCount: regimes.size, recoveryPassCount: recoveries, duplicateOrderCheckCount: duplicateChecks, passedFaultScenarios: Object.freeze([...faults].sort()), firstOccurredAt: records[0]?.event.occurredAt ?? null, lastOccurredAt: records.at(-1)?.event.occurredAt ?? null });
}
