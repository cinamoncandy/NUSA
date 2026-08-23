export type ShadowObservabilityRuntimeStatus = "IDLE" | "PRECHECK" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "HALTED" | "FAILED" | "INVALIDATED";
export type ShadowObservabilityStage = "MARKET_DATA" | "SIGNAL" | "CANDIDATE" | "DECISION" | "PERMISSION" | "RISK" | "ORDER_INTENT" | "ORDER_SUBMIT" | "ACK" | "FILL" | "RECONCILIATION" | "PNL" | "LEARNING" | "HALT" | "ERROR";
export type ShadowObservabilityEventStatus = "PASS" | "SKIP" | "FAIL" | "UNKNOWN";
export type ShadowObservabilityEventType = "SESSION_STARTED" | "SIGNAL_OBSERVED" | "HYPOTHETICAL_FILL" | "BLOCKED" | "SESSION_STOPPED" | "MARKET_CONNECTION";

export interface ShadowObservabilityEvent {
  readonly id: string;
  readonly sequence: number;
  readonly cycleId: string;
  readonly mode: "SHADOW";
  readonly eventType: ShadowObservabilityEventType;
  readonly stage?: ShadowObservabilityStage;
  readonly occurredAt: number;
  readonly sessionId: string;
  readonly symbol: string;
  readonly status: ShadowObservabilityEventStatus;
  readonly signalId?: string;
  readonly commandId?: string;
  readonly riskDecision?: "ALLOW" | "REJECT" | "HALT";
  readonly reasonCodes: readonly string[];
  readonly hypothetical: boolean;
}

export interface ShadowObservabilityAdmission {
  readonly duplicateCandleCount: number;
  readonly staleCandleCount: number;
  readonly outOfOrderCandleCount: number;
  readonly lastClosedCandleTime: number | null;
  readonly closedCandleCount: number;
}

export interface ShadowObservabilityMarketConnection {
  readonly state: string;
  readonly lastMarketMessageAt: number | null;
  readonly lastSuccessfulReconnectAt: number | null;
  readonly totalDowntimeMs: number;
  readonly episodeCount: number;
}

export interface ShadowObservabilitySnapshot {
  readonly schemaVersion: 1;
  readonly mode: "SHADOW";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly runtimeStatus: ShadowObservabilityRuntimeStatus;
  readonly generatedAt: number;
  readonly sessionId: string | null;
  readonly symbol: string;
  readonly strategyId: string;
  readonly marketDataStatus: string;
  readonly marketFreshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly marketConnection: ShadowObservabilityMarketConnection | null;
  readonly admission: ShadowObservabilityAdmission;
  readonly blockers: readonly string[];
  readonly events: readonly ShadowObservabilityEvent[];
  readonly counters: Readonly<{
    readonly signalCount: number;
    readonly hypotheticalOrderCount: number;
    readonly hypotheticalFillCount: number;
    readonly actualBrokerCallCount: 0;
    readonly actualOrderCount: number;
    readonly actualFillCount: number;
    readonly cashMutationCount: number;
    readonly positionMutationCount: number;
  }>;
}

const MAX_EVENTS = 500;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const RUNTIME_STATUSES = new Set<ShadowObservabilityRuntimeStatus>(["IDLE", "PRECHECK", "READY", "RUNNING", "PAUSED", "COMPLETED", "HALTED", "FAILED", "INVALIDATED"]);
const EVENT_TYPES = new Set<ShadowObservabilityEventType>(["SESSION_STARTED", "SIGNAL_OBSERVED", "HYPOTHETICAL_FILL", "BLOCKED", "SESSION_STOPPED", "MARKET_CONNECTION"]);
const STAGES = new Set<ShadowObservabilityStage>(["MARKET_DATA", "SIGNAL", "CANDIDATE", "DECISION", "PERMISSION", "RISK", "ORDER_INTENT", "ORDER_SUBMIT", "ACK", "FILL", "RECONCILIATION", "PNL", "LEARNING", "HALT", "ERROR"]);

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function assertSafeObject(value: unknown, path = "shadow"): void {
  if (value == null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}.${key} is prohibited in SHADOW observability`);
    assertSafeObject(child, `${path}.${key}`);
  }
}

export function validateShadowObservabilitySnapshot(snapshot: ShadowObservabilitySnapshot, maximumEvents = MAX_EVENTS): ShadowObservabilitySnapshot {
  if (snapshot.schemaVersion !== 1 || snapshot.mode !== "SHADOW" || snapshot.readOnly !== true || snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false || snapshot.aiAuthority !== "ZERO_AUTHORITY") throw new Error("SHADOW observability authority invariant violated");
  if (!RUNTIME_STATUSES.has(snapshot.runtimeStatus)) throw new Error("invalid SHADOW runtime status");
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > MAX_EVENTS) throw new Error("invalid SHADOW observability limit");
  finite(snapshot.generatedAt, "generatedAt");
  if (!snapshot.symbol.trim() || !snapshot.strategyId.trim()) throw new Error("SHADOW observability identity is invalid");
  for (const [name, value] of Object.entries(snapshot.admission)) {
    if (name === "lastClosedCandleTime") { if (value != null) finite(value as number, `admission.${name}`); }
    else nonNegativeInteger(value as number, `admission.${name}`);
  }
  if (snapshot.marketConnection != null) {
    for (const name of ["lastMarketMessageAt", "lastSuccessfulReconnectAt"] as const) if (snapshot.marketConnection[name] != null) finite(snapshot.marketConnection[name]!, `marketConnection.${name}`);
    finite(snapshot.marketConnection.totalDowntimeMs, "marketConnection.totalDowntimeMs");
    nonNegativeInteger(snapshot.marketConnection.episodeCount, "marketConnection.episodeCount");
  }
  if (snapshot.events.length > maximumEvents) throw new Error("SHADOW observability event bound exceeded");
  const ids = new Set<string>();
  let previousSequence = 0;
  for (const event of snapshot.events) {
    if (ids.has(event.id)) throw new Error("duplicate SHADOW observability event id");
    ids.add(event.id);
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) throw new Error("SHADOW observability event sequence is not deterministic");
    previousSequence = event.sequence;
    if (!event.id.trim() || !event.cycleId.trim() || !event.sessionId.trim() || !event.symbol.trim()) throw new Error("SHADOW observability event identity is invalid");
    finite(event.occurredAt, "event.occurredAt");
    if (!EVENT_TYPES.has(event.eventType) || (event.stage != null && !STAGES.has(event.stage))) throw new Error("SHADOW observability event type is invalid");
    if (!Array.isArray(event.reasonCodes) || event.reasonCodes.some((reason) => typeof reason !== "string" || !reason.trim() || FORBIDDEN_KEY.test(reason))) throw new Error("SHADOW observability reason codes are invalid");
    if (event.hypothetical !== (event.eventType === "HYPOTHETICAL_FILL")) throw new Error("SHADOW hypothetical marker is inconsistent");
  }
  for (const [name, value] of Object.entries(snapshot.counters)) nonNegativeInteger(value as number, `counters.${name}`);
  if (snapshot.counters.actualBrokerCallCount !== 0) throw new Error("SHADOW broker mutation invariant violated");
  assertSafeObject(snapshot);
  return Object.freeze(structuredClone(snapshot));
}
