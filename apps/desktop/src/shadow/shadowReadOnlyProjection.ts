import { createHash } from "node:crypto";
import { validateShadowObservabilitySnapshot, type ShadowObservabilityEvent, type ShadowObservabilityEventStatus, type ShadowObservabilitySnapshot, type ShadowObservabilityStage } from "../../../../packages/contracts/src/shadowObservabilityReadOnly";
import type { MarketConnectionDiagnostics } from "../exchange/marketConnectionSupervisor";
import type { ShadowOperationalDiagnostics } from "./shadowOperationalTypes";
import type { ShadowPilotEvent } from "./shadowPilotRuntime";

export interface ShadowReadOnlyProjectionInput {
  readonly diagnostics: ShadowOperationalDiagnostics;
  readonly events: readonly ShadowPilotEvent[];
  readonly generatedAt?: number;
}

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const reasonCodes = (event: ShadowPilotEvent): readonly string[] => Object.freeze([...event.reasonCodes].filter((reason) => reason.trim()).sort());

function stageFor(event: ShadowPilotEvent): ShadowObservabilityStage | undefined {
  if (event.eventType === "SIGNAL_OBSERVED") return "SIGNAL";
  if (event.eventType === "HYPOTHETICAL_FILL") return "FILL";
  if (event.eventType === "MARKET_CONNECTION") return "MARKET_DATA";
  return undefined;
}

function statusFor(event: ShadowPilotEvent): ShadowObservabilityEventStatus {
  if (event.eventType === "BLOCKED") return event.riskDecision === "HALT" ? "FAIL" : "FAIL";
  if (event.eventType === "MARKET_CONNECTION") return event.marketConnection?.finalReconnectState === "RECOVERED" ? "PASS" : "SKIP";
  return "PASS";
}

function eventToProjection(event: ShadowPilotEvent): ShadowObservabilityEvent {
  const projected: ShadowObservabilityEvent = {
    id: `shadow:${event.sessionId}:${event.sequence}:${hash(event.eventSha256).slice(0, 16)}`,
    sequence: event.sequence,
    cycleId: `shadow:${event.sessionId}:${event.sequence}`,
    mode: "SHADOW",
    eventType: event.eventType,
    ...(stageFor(event) == null ? {} : { stage: stageFor(event) }),
    occurredAt: event.timestamp,
    sessionId: event.sessionId,
    symbol: "",
    status: statusFor(event),
    ...(event.signalId === "session" || event.signalId === "session-stop" || event.signalId === "market-connection" ? {} : { signalId: event.signalId }),
    ...(event.commandId === "session" || event.commandId === "session-stop" ? {} : { commandId: event.commandId }),
    riskDecision: event.riskDecision,
    reasonCodes: reasonCodes(event),
    hypothetical: event.eventType === "HYPOTHETICAL_FILL"
  };
  return Object.freeze(projected);
}

function marketConnectionProjection(value: MarketConnectionDiagnostics | null): ShadowObservabilitySnapshot["marketConnection"] {
  if (value == null) return null;
  return Object.freeze({
    state: value.marketConnectionState,
    lastMarketMessageAt: value.lastMarketMessageAt,
    lastSuccessfulReconnectAt: value.lastSuccessfulReconnectAt,
    totalDowntimeMs: value.totalDowntimeMs,
    episodeCount: value.episodes.length
  });
}

/**
 * Projects existing Shadow diagnostics and hash-chained pilot evidence into a bounded,
 * read-only contract. It does not call lifecycle methods, risk gates, or execution code.
 */
export function buildShadowReadOnlyProjection(input: ShadowReadOnlyProjectionInput): ShadowObservabilitySnapshot {
  const diagnostics = input.diagnostics;
  const generatedAt = input.generatedAt ?? Date.now();
  const byIdentity = new Map<string, ShadowPilotEvent>();
  for (const event of input.events) {
    const key = `${event.sessionId}:${event.sequence}`;
    const previous = byIdentity.get(key);
    if (previous != null && previous.eventSha256 !== event.eventSha256) throw new Error("conflicting SHADOW observability event sequence");
    byIdentity.set(key, event);
  }
  const events = [...byIdentity.values()]
    .sort((left, right) => left.timestamp - right.timestamp || left.sessionId.localeCompare(right.sessionId) || left.sequence - right.sequence)
    .map((event, index) => Object.freeze({ ...eventToProjection(event), sequence: index + 1, symbol: diagnostics.symbol }));
  return validateShadowObservabilitySnapshot({
    schemaVersion: 1,
    mode: "SHADOW",
    readOnly: true,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
    runtimeStatus: diagnostics.state,
    generatedAt,
    sessionId: diagnostics.sessionId,
    symbol: diagnostics.symbol,
    strategyId: diagnostics.strategyId,
    marketDataStatus: diagnostics.marketDataStatus,
    marketFreshness: diagnostics.marketFreshness,
    marketConnection: marketConnectionProjection(diagnostics.marketConnection),
    admission: {
      duplicateCandleCount: diagnostics.duplicateCandleCount,
      staleCandleCount: diagnostics.staleCandleCount,
      outOfOrderCandleCount: diagnostics.outOfOrderCandleCount,
      lastClosedCandleTime: diagnostics.lastClosedCandleTime,
      closedCandleCount: diagnostics.closedCandleCount
    },
    blockers: Object.freeze([...diagnostics.blockers].sort()),
    events: Object.freeze(events.slice(-500)),
    counters: {
      signalCount: diagnostics.signalCount,
      hypotheticalOrderCount: diagnostics.hypotheticalOrderCount,
      hypotheticalFillCount: diagnostics.hypotheticalFillCount,
      actualBrokerCallCount: 0,
      actualOrderCount: diagnostics.actualOrderCount,
      actualFillCount: diagnostics.actualFillCount,
      cashMutationCount: diagnostics.cashMutationCount,
      positionMutationCount: diagnostics.positionMutationCount
    }
  });
}
