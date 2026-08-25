import type { EventMap } from "../eventBus";
import type { MarketConnectionDiagnostics, MarketReconnectFailureReason } from "../marketConnectionSupervisor";

export type ImprovementSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ImprovementRecurrence = "NEW" | "RECURRING";
export type RootCauseEvidenceStatus = "CORRELATED" | "INSUFFICIENT_EVIDENCE" | "CONTRADICTORY";
export type RootCauseHypothesisStatus = "EVIDENCE_BOUND" | "UNRESOLVED" | "BLOCKED";

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

export interface ImprovementDiagnosticEvidence {
  readonly id: string;
  readonly fingerprint: string;
  readonly type: ImprovementSignal["type"];
  readonly source: ImprovementSignal["source"];
  readonly observedAt: number;
  readonly state: "RECONNECTING" | "FAILED";
  readonly reconnectAttempt: number;
  readonly reconnectAttemptLimit: number;
  readonly downtimeMs: number;
  readonly failureReason: MarketReconnectFailureReason | null;
}

export type RootCauseEvidenceFactorCode =
  | "STATE_FAILED"
  | "FAILURE_REASON_PRESENT"
  | "DOWNTIME_BUCKET"
  | "RECONNECT_ATTEMPT_BUCKET"
  | "RECENCY_BUCKET";

export interface RootCauseEvidenceFactor {
  readonly code: RootCauseEvidenceFactorCode;
  readonly value: number;
  readonly points: number;
  readonly reason: string;
}

export interface RankedRootCauseEvidence {
  readonly evidenceId: string;
  readonly rank: number;
  readonly score: number;
  readonly factors: readonly RootCauseEvidenceFactor[];
  readonly reasonCodes: readonly RootCauseEvidenceFactorCode[];
}

export interface RootCauseHypothesis {
  readonly id: string;
  readonly candidateFingerprint: string;
  readonly status: RootCauseHypothesisStatus;
  /** Describes observed evidence only; it never asserts a causal explanation. */
  readonly statement: string;
  readonly evidenceIds: readonly string[];
  readonly rankingReasonCodes: readonly RootCauseEvidenceFactorCode[];
  readonly unresolvedCodes: readonly string[];
  readonly generatedAt: number;
}

export type RemediationProposalStatus = "PROPOSED" | "BLOCKED";
export type RemediationProposalRiskClass = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
export type RemediationProposalChangeSurface = "OBSERVABILITY" | "RECOVERY_CONFIGURATION" | "PERSISTENCE" | "UNKNOWN";

export interface RemediationProposal {
  readonly id: string;
  readonly hypothesisId: string;
  readonly candidateFingerprint: string;
  readonly status: RemediationProposalStatus;
  readonly title: string;
  readonly rationale: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly unresolvedAssumptions: readonly string[];
  /** Always an unverified, human-reviewable outcome; never a promised return or fix. */
  readonly expectedImpact: "UNVERIFIED_OBSERVABILITY_IMPROVEMENT" | "UNVERIFIED";
  readonly changeSurface: RemediationProposalChangeSurface;
  readonly riskClass: RemediationProposalRiskClass;
  readonly reversible: boolean;
  readonly reversibilityPlan: string;
  readonly verificationPlan: readonly string[];
  readonly requiresHumanReview: true;
  readonly executable: false;
  readonly reasonCodes: readonly string[];
  readonly generatedAt: number;
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
  readonly evidence: readonly ImprovementDiagnosticEvidence[];
  readonly recurrence: ImprovementRecurrence;
  readonly title: string;
  readonly status: "PENDING_REVIEW";
}

export interface ImprovementCandidateHistory extends Omit<ImprovementCandidate, "status"> {
  readonly status: "OBSERVED" | "PENDING_REVIEW";
}

export interface RootCauseEvidenceBundle {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateFingerprint: string;
  readonly status: RootCauseEvidenceStatus;
  /** Coverage of candidate occurrences by verified evidence; never an inferred cause probability. */
  readonly confidence: number | null;
  readonly evidence: readonly ImprovementDiagnosticEvidence[];
  readonly provenance: readonly { readonly evidenceId: string; readonly source: string; readonly observedAt: number }[];
  readonly correlationReasons: readonly string[];
  readonly contradictionCodes: readonly string[];
  readonly rankedEvidence: readonly RankedRootCauseEvidence[];
  readonly hypotheses: readonly RootCauseHypothesis[];
  readonly remediationProposals: readonly RemediationProposal[];
  readonly generatedAt: number;
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
  "improvement.rootCauseEvidence": RootCauseEvidenceBundle;
  "improvement.remediationProposal": RemediationProposal;
} & EventMap;

export interface ImprovementObservationResult {
  readonly signal: ImprovementSignal | null;
  readonly candidate: ImprovementCandidate | null;
  readonly evidenceBundle: RootCauseEvidenceBundle | null;
  readonly reason?: "MALFORMED_DIAGNOSTICS" | "BELOW_THRESHOLD" | "PERSISTENCE_UNAVAILABLE";
}
