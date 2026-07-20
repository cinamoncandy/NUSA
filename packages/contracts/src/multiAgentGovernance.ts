/**
 * Zero-authority contracts for deterministic multi-agent analytical review.
 * No value in this module is an authorization, order, transfer, or credential.
 */
export enum AgentRole {
  EVIDENCE_PRODUCER = "evidence-producer",
  STRATEGY_PROPOSER = "strategy-proposer",
  ADVERSARIAL_CRITIC = "adversarial-critic",
  RISK_VERIFIER = "risk-verifier",
  OBSERVER = "observer"
}

export enum AgentStatus {
  REGISTERED = "registered",
  VALIDATED = "validated",
  ACTIVE = "active",
  RESTRICTED = "restricted",
  SUSPENDED = "suspended",
  RETIRED = "retired",
  REVOKED = "revoked"
}

export enum AgentRunStatus {
  PLANNED = "planned",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  TIMED_OUT = "timed_out",
  INVALIDATED = "invalidated",
  CONTAINED = "contained"
}

export enum EvidenceQuality {
  VERIFIED = "verified",
  PROVISIONAL = "provisional",
  STALE = "stale",
  CONFLICTED = "conflicted",
  UNKNOWN = "unknown"
}

export enum EvidenceClaimStatus {
  VERIFIED = "verified",
  WEAKLY_SUPPORTED = "weakly_supported",
  UNSUPPORTED = "unsupported",
  CONTRADICTED = "contradicted",
  FABRICATED_REFERENCE = "fabricated_reference"
}

export type AgentRoleContractStatus = "draft" | "validated" | "active" | "deprecated" | "revoked";
export type AgentClaimType = "fact" | "derived" | "assumption" | "unknown";
export type FreshnessStatus = "fresh" | "stale" | "conflicted" | "unknown";
export type AgentDecision = "candidate" | "no_action" | "insufficient_evidence";
export type ReviewSeverity = "none" | "low" | "medium" | "high" | "critical";
export type RiskVerificationResult = "verified" | "denied" | "incomplete";
export type MultiAgentResult = "preview_candidate" | "deny" | "incomplete" | "escalation_required" | "no_action";
export type DisagreementType = "evidence-conflict" | "assumption-conflict" | "scope-conflict" | "policy-conflict" | "model-conflict" | "confidence-conflict" | "economic-significance-conflict" | "risk-conflict" | "freshness-conflict" | "unknown";

export interface AgentDefinition {
  readonly agentId: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly definitionVersion: string;
  readonly modelVersionId: string;
  readonly modelCertificationId: string;
  readonly promptArtifactId: string;
  readonly promptArtifactDigest: string;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly allowedEvidenceClasses: readonly string[];
  readonly allowedToolCapabilities: readonly string[];
  readonly contextIsolationPolicyId: string;
  readonly timeoutPolicyId: string;
  /** Same group means correlated failure risk, not independent consensus. */
  readonly correlatedGroupId: string;
  readonly status: AgentStatus;
}

export interface AgentRoleContract {
  readonly contractId: string;
  readonly role: AgentRole;
  readonly requiredInputs: readonly string[];
  readonly permittedOutputs: readonly string[];
  readonly prohibitedOutputs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly timeoutBehavior: "deny" | "incomplete";
  readonly fallbackPolicyId: string;
  readonly status: AgentRoleContractStatus;
}

export interface AgentEvidence {
  readonly evidenceId: string;
  readonly evidenceType: "market-data" | "risk-state" | "model-state" | "venue-state" | "accounting-state" | "treasury-state" | "counterparty-state" | "policy-state" | "incident-state" | "derived-calculation";
  readonly sourceReference: string;
  readonly observedAt: number;
  readonly validUntil?: number;
  readonly quality: EvidenceQuality;
  readonly contentDigest: string;
  readonly lineageReferences: readonly string[];
}

export interface AgentContextSnapshot {
  readonly contextSnapshotId: string;
  readonly agentId: string;
  readonly evidenceIds: readonly string[];
  readonly policyVersionIds: readonly string[];
  readonly certificationIds: readonly string[];
  readonly controlPlaneStateId: string;
  readonly createdAt: number;
  readonly validUntil: number;
  readonly contextHash: string;
}

export interface AgentContextSnapshotInput extends Omit<AgentContextSnapshot, "contextHash"> {}

export interface AgentRun {
  readonly agentRunId: string;
  readonly agentId: string;
  readonly orchestrationRunId: string;
  readonly agentDefinitionVersion: string;
  readonly modelVersionId: string;
  readonly promptArtifactDigest: string;
  readonly contextSnapshotId: string;
  readonly inputHash: string;
  readonly status: AgentRunStatus;
  readonly outputHash?: string;
  readonly schemaValidationPassed?: boolean;
  readonly evidenceValidationPassed?: boolean;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface EvidenceObservation {
  readonly claim: string;
  readonly claimType: AgentClaimType;
  readonly evidenceReferences: readonly string[];
  readonly confidence?: string;
  readonly freshnessStatus: FreshnessStatus;
}

export interface EvidenceAssessment {
  readonly evidenceAssessmentId: string;
  readonly agentRunId: string;
  readonly observations: readonly EvidenceObservation[];
  readonly missingEvidence: readonly string[];
  readonly evidenceBundleHash: string;
}

export interface StrategyProposal {
  readonly proposalId: string;
  readonly agentRunId: string;
  readonly strategyVersionId: string;
  readonly decision: AgentDecision;
  readonly rationaleClaims: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: string;
  readonly expectedEffect?: string;
  readonly costSensitivity?: string;
  readonly capacitySensitivity?: string;
  readonly proposalHash: string;
}

export interface AdversarialReview {
  readonly reviewId: string;
  readonly agentRunId: string;
  readonly reviewedProposalHash: string;
  readonly counterClaims: readonly string[];
  readonly failedAssumptions: readonly string[];
  readonly missingTests: readonly string[];
  readonly alternativeExplanations: readonly string[];
  readonly severity: ReviewSeverity;
  readonly reviewHash: string;
}

export interface IndependentRiskVerification {
  readonly verificationId: string;
  readonly agentRunId: string;
  readonly result: RiskVerificationResult;
  readonly hardDenies: readonly string[];
  readonly warnings: readonly string[];
  readonly missingRequirements: readonly string[];
  readonly requiredEscalations: readonly string[];
  readonly policyReferences: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly verificationHash: string;
}

export interface AgentDisagreement {
  readonly disagreementId: string;
  readonly type: DisagreementType;
  readonly agentRunIds: readonly string[];
  readonly claimReferences: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly severity: ReviewSeverity;
  readonly resolutionPolicyId: string;
  readonly unresolved: boolean;
}

export interface AgentCalibrationObservation {
  readonly predictedConfidence: number;
  readonly correct: boolean;
}

export interface AgentCalibrationProfile {
  readonly agentId: string;
  readonly evaluationWindow: string;
  readonly sampleCount: number;
  readonly expectedCalibrationError: number | undefined;
  readonly calibrationStatus: "calibrated" | "degraded" | "uncalibrated" | "insufficient-data";
}

export interface AgentIndependenceAssessment {
  readonly agentIds: readonly string[];
  readonly sharedCorrelatedGroups: readonly string[];
  readonly independent: boolean;
  readonly reasonCodes: readonly string[];
}

export interface MultiAgentDecisionInput {
  readonly decisionId: string;
  readonly evaluatedAt: number;
  readonly agents: readonly AgentDefinition[];
  readonly roleContracts: readonly AgentRoleContract[];
  readonly evidence: readonly AgentEvidence[];
  readonly contexts: readonly AgentContextSnapshot[];
  readonly runs: readonly AgentRun[];
  readonly evidenceAssessment: EvidenceAssessment;
  readonly proposal: StrategyProposal;
  readonly adversarialReview?: AdversarialReview;
  readonly riskVerification: IndependentRiskVerification;
  readonly disagreements: readonly AgentDisagreement[];
  readonly controlVetoReasons: readonly string[];
}

export interface MultiAgentDecisionResult {
  readonly decisionId: string;
  readonly result: MultiAgentResult;
  readonly evidenceAssessmentId: string;
  readonly proposalId?: string;
  readonly adversarialReviewId?: string;
  readonly riskVerificationId: string;
  readonly vetoReasons: readonly string[];
  readonly unresolvedDisagreements: readonly string[];
  readonly policyReferences: readonly string[];
  readonly decisionPolicyId: "MULTI_AGENT_ZERO_AUTHORITY_V1";
  readonly decisionHash: string;
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}

export enum MultiAgentGovernanceEventType {
  AGENT_REGISTERED = "AGENT_REGISTERED",
  AGENT_VALIDATED = "AGENT_VALIDATED",
  AGENT_ACTIVATED = "AGENT_ACTIVATED",
  AGENT_SUSPENDED = "AGENT_SUSPENDED",
  AGENT_EVIDENCE_REGISTERED = "AGENT_EVIDENCE_REGISTERED",
  AGENT_CONTEXT_SNAPSHOT_CREATED = "AGENT_CONTEXT_SNAPSHOT_CREATED",
  AGENT_RUN_COMPLETED = "AGENT_RUN_COMPLETED",
  AGENT_RUN_FAILED = "AGENT_RUN_FAILED",
  AGENT_DISAGREEMENT_DETECTED = "AGENT_DISAGREEMENT_DETECTED",
  RISK_VETO_ISSUED = "RISK_VETO_ISSUED",
  MULTI_AGENT_DECISION_EVALUATED = "MULTI_AGENT_DECISION_EVALUATED",
  MULTI_AGENT_DECISION_DENIED = "MULTI_AGENT_DECISION_DENIED",
  MULTI_AGENT_INCIDENT_OPENED = "MULTI_AGENT_INCIDENT_OPENED",
  MULTI_AGENT_CERTIFICATION_ISSUED_ZERO_AUTHORITY = "MULTI_AGENT_CERTIFICATION_ISSUED_ZERO_AUTHORITY"
}

export interface MultiAgentGovernanceEvent {
  readonly eventId: string;
  readonly type: MultiAgentGovernanceEventType;
  readonly occurredAt: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidenceHash: string;
}

export interface MultiAgentGovernanceRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: MultiAgentGovernanceEvent;
  readonly hash: string;
}
