import type { MarketConnectionDiagnostics, MarketConnectionState, MarketReconnectFailureReason } from "../marketConnectionSupervisor";
import {
  DEFAULT_IMPROVEMENT_OBSERVER_POLICY,
  type ImprovementObserverPolicy,
  type ImprovementSeverity,
  type ImprovementSignal
} from "./improvementTypes";

const VALID_STATES = new Set<MarketConnectionState>(["CONNECTED", "STALE", "DISCONNECTED", "RECONNECTING", "RECOVERED", "FAILED"]);
const VALID_FAILURE_REASONS = new Set<MarketReconnectFailureReason>(["MAX_ATTEMPTS_EXCEEDED", "MAX_RECONNECT_TIME_EXCEEDED"]);

export function validateImprovementObserverPolicy(policy: ImprovementObserverPolicy): readonly string[] {
  const violations: string[] = [];
  if (!Number.isSafeInteger(policy.minReconnectAttempts) || policy.minReconnectAttempts < 1) violations.push("MIN_RECONNECT_ATTEMPTS_INVALID");
  if (!Number.isSafeInteger(policy.minDowntimeMs) || policy.minDowntimeMs < 0) violations.push("MIN_DOWNTIME_INVALID");
  if (!Number.isSafeInteger(policy.minOccurrences) || policy.minOccurrences < 1) violations.push("MIN_OCCURRENCES_INVALID");
  if (!Number.isSafeInteger(policy.maxSignals) || policy.maxSignals < 1) violations.push("MAX_SIGNALS_INVALID");
  if (!Number.isSafeInteger(policy.maxCandidates) || policy.maxCandidates < 1) violations.push("MAX_CANDIDATES_INVALID");
  return Object.freeze(violations);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDiagnostics(value: unknown): value is MarketConnectionDiagnostics {
  if (value === null || typeof value !== "object") return false;
  const diagnostics = value as Partial<MarketConnectionDiagnostics>;
  if (typeof diagnostics.marketConnectionState !== "string" || !VALID_STATES.has(diagnostics.marketConnectionState)) return false;
  if (!isFiniteNonNegativeInteger(diagnostics.reconnectAttempt) || !isFiniteNonNegativeInteger(diagnostics.reconnectAttemptLimit)) return false;
  if (diagnostics.reconnectStartedAt !== null && diagnostics.reconnectStartedAt !== undefined && !isFiniteNonNegativeInteger(diagnostics.reconnectStartedAt)) return false;
  if (diagnostics.reconnectFailureReason !== null && diagnostics.reconnectFailureReason !== undefined && !VALID_FAILURE_REASONS.has(diagnostics.reconnectFailureReason)) return false;
  if (!isFiniteNonNegativeInteger(diagnostics.currentDowntimeMs) || !isFiniteNonNegativeInteger(diagnostics.totalDowntimeMs)) return false;
  return true;
}

function severityFor(state: "RECONNECTING" | "FAILED"): ImprovementSeverity {
  return state === "FAILED" ? "HIGH" : "MEDIUM";
}

function identityFor(diagnostics: MarketConnectionDiagnostics): string {
  return diagnostics.reconnectFailureReason ?? diagnostics.marketConnectionState;
}

export function detectImprovementSignal(
  input: unknown,
  observedAt: unknown,
  policy: ImprovementObserverPolicy = DEFAULT_IMPROVEMENT_OBSERVER_POLICY
): ImprovementSignal | null {
  if (validateImprovementObserverPolicy(policy).length > 0 || !isDiagnostics(input) || !isFiniteNonNegativeInteger(observedAt)) return null;
  if (input.marketConnectionState !== "RECONNECTING" && input.marketConnectionState !== "FAILED") return null;
  if (input.reconnectAttempt < policy.minReconnectAttempts || input.currentDowntimeMs < policy.minDowntimeMs) return null;
  const state = input.marketConnectionState;
  const fingerprint = `MARKET_RECONNECT_INSTABILITY|MarketConnectionSupervisor|${identityFor(input)}`;
  const severity = severityFor(state);
  return Object.freeze({
    id: `signal:${fingerprint}:${observedAt}`,
    type: "MARKET_RECONNECT_INSTABILITY" as const,
    source: "MarketConnectionSupervisor" as const,
    fingerprint,
    severity,
    observedAt,
    summary: "Public market reconnect instability requires human review",
    evidence: Object.freeze({
      state,
      reconnectAttempt: input.reconnectAttempt,
      reconnectAttemptLimit: input.reconnectAttemptLimit,
      downtimeMs: input.currentDowntimeMs,
      failureReason: input.reconnectFailureReason
    })
  });
}
