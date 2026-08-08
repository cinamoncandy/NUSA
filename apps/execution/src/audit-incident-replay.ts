import { createHash } from "node:crypto";

export type ReplayActorKind = "HUMAN" | "SYSTEM" | "AI" | "META_AI" | "AUTOMATION" | "PROVIDER";
export type SafetyReplayEventType =
  | "OPERATIONS_SNAPSHOT"
  | "HARD_RISK_DECISION"
  | "KILL_SWITCH_STATE"
  | "RECONCILIATION"
  | "GOVERNANCE_TRANSITION"
  | "INCIDENT"
  | "CONTROL_REQUEST";

export interface SafetyReplayEvent {
  readonly eventId: string;
  readonly eventType: SafetyReplayEventType;
  readonly actorId: string;
  readonly actorKind: ReplayActorKind;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sourceRefs: readonly string[];
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SafetyReplayRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: SafetyReplayEvent;
  readonly hash: string;
}

export interface ReplayExpectation {
  readonly expectedEventCount?: number;
  readonly expectedChainHash?: string;
}

export interface SafetyReplaySnapshot {
  readonly status: "VALID" | "UNKNOWN";
  readonly eventCount: number;
  readonly chainHash: string;
  readonly fingerprint: string;
  readonly processedEventIds: readonly string[];
  readonly operationsHealth: "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
  readonly hardRisk: "PASS" | "REJECT" | "BLOCK" | "UNKNOWN";
  readonly killSwitch: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  readonly reconciliation: "MATCH" | "DIFF" | "UNKNOWN";
  readonly governanceState: string;
  readonly incidentCount: number;
  readonly safeControlRequestCount: number;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
}

export const AUDIT_INCIDENT_REPLAY_DESCRIPTOR = Object.freeze({
  mode: "OBSERVATIONAL_REPLAY" as const,
  appendOnly: true as const,
  tamperEvident: true as const,
  deterministic: true as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  credentialExecutionUse: false as const,
  realMoneyExecutionAllowed: false as const
});

const GENESIS_HASH = "0".repeat(64);
const EVENT_TYPES = new Set<SafetyReplayEventType>([
  "OPERATIONS_SNAPSHOT",
  "HARD_RISK_DECISION",
  "KILL_SWITCH_STATE",
  "RECONCILIATION",
  "GOVERNANCE_TRANSITION",
  "INCIDENT",
  "CONTROL_REQUEST"
]);
const ACTOR_KINDS = new Set<ReplayActorKind>(["HUMAN", "SYSTEM", "AI", "META_AI", "AUTOMATION", "PROVIDER"]);
const forbiddenKey = /secret|password|token|signature|private.?key|access.?key|credential|authorization/i;
const forbiddenValue = /bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function assertIso(value: string, code: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(code);
  return value;
}

function normalizePayload(value: unknown, key = "payload"): unknown {
  if (forbiddenKey.test(key)) throw new Error("AUDIT_REPLAY_SECRET_MATERIAL_PROHIBITED");
  if (typeof value === "string") {
    if (forbiddenValue.test(value)) throw new Error("AUDIT_REPLAY_SECRET_MATERIAL_PROHIBITED");
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((item) => normalizePayload(item)));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([childKey, child]) => [childKey, normalizePayload(child, childKey)] as const);
    return Object.freeze(Object.fromEntries(entries));
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  throw new Error("AUDIT_REPLAY_PAYLOAD_TYPE_INVALID");
}

function normalizeEvent(event: SafetyReplayEvent): SafetyReplayEvent {
  const eventId = assertText(event.eventId, "AUDIT_REPLAY_EVENT_ID_REQUIRED");
  const actorId = assertText(event.actorId, "AUDIT_REPLAY_ACTOR_ID_REQUIRED");
  if (!EVENT_TYPES.has(event.eventType)) throw new Error("AUDIT_REPLAY_EVENT_TYPE_INVALID");
  if (!ACTOR_KINDS.has(event.actorKind)) throw new Error("AUDIT_REPLAY_ACTOR_KIND_INVALID");
  const occurredAt = assertIso(event.occurredAt, "AUDIT_REPLAY_OCCURRED_AT_INVALID");
  const observedAt = assertIso(event.observedAt, "AUDIT_REPLAY_OBSERVED_AT_INVALID");
  if (Date.parse(observedAt) < Date.parse(occurredAt)) throw new Error("AUDIT_REPLAY_OBSERVED_BEFORE_OCCURRED");
  if (!/^[0-9a-f]{40}$/.test(event.codeRevision)) throw new Error("AUDIT_REPLAY_CODE_REVISION_INVALID");
  if (!/^[0-9a-f]{64}$/.test(event.configurationHash)) throw new Error("AUDIT_REPLAY_CONFIGURATION_HASH_INVALID");
  if (!Array.isArray(event.sourceRefs) || event.sourceRefs.length === 0) throw new Error("AUDIT_REPLAY_SOURCE_REFS_REQUIRED");
  const sourceRefs = [...new Set(event.sourceRefs.map((ref) => assertText(ref, "AUDIT_REPLAY_SOURCE_REF_INVALID")))].sort();
  if (sourceRefs.length !== event.sourceRefs.length) throw new Error("AUDIT_REPLAY_SOURCE_REF_DUPLICATE");
  const payload = normalizePayload(event.payload) as Readonly<Record<string, unknown>>;
  return Object.freeze({ ...event, eventId, actorId, occurredAt, observedAt, sourceRefs: Object.freeze(sourceRefs), payload });
}

function recordHash(sequence: number, previousHash: string, event: SafetyReplayEvent): string {
  return sha256(canonical({ sequence, previousHash, event }));
}

function assertKnownValue<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(code);
  return value as T;
}

export function replaySafetyHistory(
  records: readonly SafetyReplayRecord[],
  expectation: ReplayExpectation = {}
): SafetyReplaySnapshot {
  let expectedPreviousHash = GENESIS_HASH;
  let lastOccurred = -1;
  let operationsHealth: SafetyReplaySnapshot["operationsHealth"] = "UNKNOWN";
  let hardRisk: SafetyReplaySnapshot["hardRisk"] = "UNKNOWN";
  let killSwitch: SafetyReplaySnapshot["killSwitch"] = "UNKNOWN";
  let reconciliation: SafetyReplaySnapshot["reconciliation"] = "UNKNOWN";
  let governanceState = "UNKNOWN";
  let incidentCount = 0;
  let safeControlRequestCount = 0;
  const ids = new Set<string>();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sequence = index + 1;
    if (record.sequence !== sequence) throw new Error(`AUDIT_REPLAY_SEQUENCE_MISMATCH:${sequence}`);
    if (record.previousHash !== expectedPreviousHash) throw new Error(`AUDIT_REPLAY_PREVIOUS_HASH_MISMATCH:${sequence}`);
    const event = normalizeEvent(record.event);
    if (ids.has(event.eventId)) throw new Error(`AUDIT_REPLAY_DUPLICATE_EVENT_ID:${event.eventId}`);
    ids.add(event.eventId);
    const occurred = Date.parse(event.occurredAt);
    if (occurred < lastOccurred) throw new Error(`AUDIT_REPLAY_TIME_ORDER_INVALID:${sequence}`);
    const expectedHash = recordHash(sequence, expectedPreviousHash, event);
    if (record.hash !== expectedHash) throw new Error(`AUDIT_REPLAY_HASH_MISMATCH:${sequence}`);

    switch (event.eventType) {
      case "OPERATIONS_SNAPSHOT":
        operationsHealth = assertKnownValue(event.payload.overallHealth, ["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"], "AUDIT_REPLAY_OPERATIONS_HEALTH_INVALID");
        break;
      case "HARD_RISK_DECISION":
        hardRisk = assertKnownValue(event.payload.decision, ["PASS", "REJECT", "BLOCK", "UNKNOWN"], "AUDIT_REPLAY_HARD_RISK_INVALID");
        break;
      case "KILL_SWITCH_STATE": {
        const state = assertKnownValue(event.payload.state, ["ACTIVE", "INACTIVE", "UNKNOWN"], "AUDIT_REPLAY_KILL_SWITCH_INVALID");
        killSwitch = state;
        break;
      }
      case "RECONCILIATION":
        reconciliation = assertKnownValue(event.payload.state, ["MATCH", "DIFF", "UNKNOWN"], "AUDIT_REPLAY_RECONCILIATION_INVALID");
        break;
      case "GOVERNANCE_TRANSITION":
        governanceState = assertText(String(event.payload.state ?? ""), "AUDIT_REPLAY_GOVERNANCE_STATE_INVALID");
        break;
      case "INCIDENT":
        incidentCount += 1;
        break;
      case "CONTROL_REQUEST": {
        const action = assertKnownValue(event.payload.action, ["REQUEST_HALT", "REQUEST_RECOVERY_REVIEW"], "AUDIT_REPLAY_UNSAFE_CONTROL_REQUEST");
        if (action) safeControlRequestCount += 1;
        break;
      }
    }

    expectedPreviousHash = record.hash;
    lastOccurred = occurred;
  }

  if (expectation.expectedEventCount !== undefined && records.length !== expectation.expectedEventCount) {
    throw new Error("AUDIT_REPLAY_EXPECTED_COUNT_MISMATCH");
  }
  if (expectation.expectedChainHash !== undefined && expectedPreviousHash !== expectation.expectedChainHash) {
    throw new Error("AUDIT_REPLAY_EXPECTED_CHAIN_HASH_MISMATCH");
  }

  const status: SafetyReplaySnapshot["status"] =
    operationsHealth === "UNKNOWN" || hardRisk === "UNKNOWN" || killSwitch === "UNKNOWN" || reconciliation === "UNKNOWN" || governanceState === "UNKNOWN"
      ? "UNKNOWN"
      : "VALID";
  const processedEventIds = Object.freeze([...ids]);
  const fingerprint = sha256(canonical({
    status,
    eventCount: records.length,
    chainHash: expectedPreviousHash,
    processedEventIds,
    operationsHealth,
    hardRisk,
    killSwitch,
    reconciliation,
    governanceState,
    incidentCount,
    safeControlRequestCount,
    executionAuthority: false,
    authorizesLive: false
  }));
  return Object.freeze({ status, eventCount: records.length, chainHash: expectedPreviousHash, fingerprint, processedEventIds, operationsHealth, hardRisk, killSwitch, reconciliation, governanceState, incidentCount, safeControlRequestCount, executionAuthority: false, authorizesLive: false });
}

export function appendSafetyReplayEvent(
  records: readonly SafetyReplayRecord[],
  event: SafetyReplayEvent
): readonly SafetyReplayRecord[] {
  replaySafetyHistory(records);
  const normalized = normalizeEvent(event);
  if (records.some((record) => record.event.eventId === normalized.eventId)) throw new Error(`AUDIT_REPLAY_DUPLICATE_EVENT_ID:${normalized.eventId}`);
  if (records.length > 0 && Date.parse(normalized.occurredAt) < Date.parse(records[records.length - 1].event.occurredAt)) throw new Error("AUDIT_REPLAY_TIME_ORDER_INVALID");
  const sequence = records.length + 1;
  const previousHash = records.length === 0 ? GENESIS_HASH : records[records.length - 1].hash;
  const record = Object.freeze({ sequence, previousHash, event: normalized, hash: recordHash(sequence, previousHash, normalized) });
  const next = Object.freeze([...records, record]);
  replaySafetyHistory(next);
  return next;
}
