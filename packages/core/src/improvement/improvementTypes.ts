import type { EventMap } from "../eventBus";
import type { MarketConnectionDiagnostics, MarketReconnectFailureReason } from "../marketConnectionSupervisor";

export type ImprovementSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ImprovementRecurrence = "NEW" | "RECURRING";

export interface ImprovementDiagnosticsEvent {
  readonly observedAt: number;
  readonly diagnostics: MarketConnectionDiagnostics;
}

export interface ImprovementSignal {
  readonly id: string;
  readonly type: "MARKET_RECONNECT_INSTABILITY";
  readonly source: "MarketConnectionSupervisor";
  readonly fingerprint: string;
  readonly severity: ImprovementSeverity;
  readonly observedAt: number;
  readonly summary: string;
  readonly evidence: Readonly<{
    state: "RECONNECTING" | "FAILED";
    reconnectAttempt: number;
    reconnectAttemptLimit: number;
    downtimeMs: number;
    failureReason: MarketReconnectFailureReason | null;
  }>;
}

export interface ImprovementCandidate {
  readonly id: string;
  readonly fingerprint: string;
  readonly type: ImprovementSignal["type"];
  readonly source: ImprovementSignal["source"];
  readonly severity: ImprovementSeverity;
  readonly score: number;
  readonly occurrences: number;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly occurrenceTimestamps: readonly number[];
  readonly recurrence: ImprovementRecurrence;
  readonly title: string;
  readonly status: "PENDING_REVIEW";
}

export interface ImprovementCandidateHistory extends Omit<ImprovementCandidate, "status"> {
  readonly status: "OBSERVED" | "PENDING_REVIEW";
}

export interface ImprovementCandidateMemory {
  load(): readonly ImprovementCandidateHistory[];
  save(history: ImprovementCandidateHistory): void;
}

export interface ImprovementObserverPolicy {
  readonly minReconnectAttempts: number;
  readonly minDowntimeMs: number;
  readonly minOccurrences: number;
  readonly maxSignals: number;
  readonly maxCandidates: number;
}

export const DEFAULT_IMPROVEMENT_OBSERVER_POLICY: ImprovementObserverPolicy = Object.freeze({
  minReconnectAttempts: 2,
  minDowntimeMs: 30_000,
  minOccurrences: 2,
  maxSignals: 256,
  maxCandidates: 64
});

export type ImprovementEventMap = {
  "market.connection.diagnostics": ImprovementDiagnosticsEvent;
  "improvement.signal": ImprovementSignal;
  "improvement.candidate": ImprovementCandidate;
} & EventMap;

export interface ImprovementObservationResult {
  readonly signal: ImprovementSignal | null;
  readonly candidate: ImprovementCandidate | null;
  readonly reason?: "MALFORMED_DIAGNOSTICS" | "BELOW_THRESHOLD" | "PERSISTENCE_UNAVAILABLE";
}
