import { createHash } from "node:crypto";
import {
  AgentRole,
  AgentRunStatus,
  AgentStatus,
  EvidenceClaimStatus,
  EvidenceQuality,
  MultiAgentGovernanceEventType,
  type AdversarialReview,
  type AgentCalibrationObservation,
  type AgentCalibrationProfile,
  type AgentContextSnapshot,
  type AgentContextSnapshotInput,
  type AgentDefinition,
  type AgentDisagreement,
  type AgentEvidence,
  type AgentIndependenceAssessment,
  type AgentRoleContract,
  type AgentRun,
  type EvidenceAssessment,
  type IndependentRiskVerification,
  type MultiAgentDecisionInput,
  type MultiAgentDecisionResult,
  type MultiAgentGovernanceEvent,
  type MultiAgentGovernanceRecord,
  type StrategyProposal
} from "../../../packages/contracts/src/multiAgentGovernance";

const genesis = "0".repeat(64);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const unsafeCapabilities = new Set(["ORDER", "TRANSFER", "CREDENTIAL", "SECRET", "PRODUCTION_MUTATION", "LIVE_EXECUTION"]);
const text = (value: string, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};
const timestamp = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};
const freeze = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const uniqueText = (items: readonly string[], field: string): readonly string[] => {
  const normalized = items.map(value => text(value, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} values must be unique`);
  return freeze(normalized.sort());
};

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
    }
    throw new Error("canonical serialization rejected unsupported value");
  };
  return JSON.stringify(normalize(value));
}

const definitionKey = (agent: AgentDefinition): string => `${agent.agentId}@${agent.definitionVersion}`;

export function createAgentDefinition(agent: AgentDefinition): AgentDefinition {
  const capabilities = uniqueText(agent.allowedToolCapabilities, "tool capability");
  if (capabilities.some(capability => unsafeCapabilities.has(capability.toUpperCase()))) throw new Error("agent capability exceeds zero-authority scope");
  if (!validHash(agent.promptArtifactDigest)) throw new Error("promptArtifactDigest must be sha256");
  return Object.freeze({
    ...agent,
    agentId: text(agent.agentId, "agentId"), name: text(agent.name, "agent name"), definitionVersion: text(agent.definitionVersion, "agent definitionVersion"), modelVersionId: text(agent.modelVersionId, "modelVersionId"), modelCertificationId: text(agent.modelCertificationId, "modelCertificationId"), promptArtifactId: text(agent.promptArtifactId, "promptArtifactId"), inputSchemaId: text(agent.inputSchemaId, "inputSchemaId"), outputSchemaId: text(agent.outputSchemaId, "outputSchemaId"), contextIsolationPolicyId: text(agent.contextIsolationPolicyId, "contextIsolationPolicyId"), timeoutPolicyId: text(agent.timeoutPolicyId, "timeoutPolicyId"), correlatedGroupId: text(agent.correlatedGroupId, "correlatedGroupId"),
    allowedEvidenceClasses: uniqueText(agent.allowedEvidenceClasses, "evidence class"), allowedToolCapabilities: capabilities
  });
}

export function registerAgentDefinition(existing: ReadonlyMap<string, AgentDefinition>, candidate: AgentDefinition): AgentDefinition {
  const normalized = createAgentDefinition(candidate); const current = existing.get(definitionKey(normalized));
  if (current == null) return normalized;
  if (canonical(current) === canonical(normalized)) return current;
  throw new Error("agent definition version conflict");
}

export function createAgentRoleContract(contract: AgentRoleContract): AgentRoleContract {
  const permitted = uniqueText(contract.permittedOutputs, "permitted output");
  const prohibited = uniqueText(contract.prohibitedOutputs, "prohibited output");
  if (permitted.some(value => prohibited.includes(value))) throw new Error("role contract output cannot be both permitted and prohibited");
  return Object.freeze({ ...contract, contractId: text(contract.contractId, "contractId"), fallbackPolicyId: text(contract.fallbackPolicyId, "fallbackPolicyId"), requiredInputs: uniqueText(contract.requiredInputs, "required input"), permittedOutputs: permitted, prohibitedOutputs: prohibited, evidenceRequirements: uniqueText(contract.evidenceRequirements, "evidence requirement") });
}

export function createAgentEvidence(evidence: AgentEvidence): AgentEvidence {
  timestamp(evidence.observedAt, "evidence observedAt");
  if (evidence.validUntil != null && timestamp(evidence.validUntil, "evidence validUntil") <= evidence.observedAt) throw new Error("evidence validUntil must follow observedAt");
  if (!validHash(evidence.contentDigest)) throw new Error("evidence contentDigest must be sha256");
  return Object.freeze({ ...evidence, evidenceId: text(evidence.evidenceId, "evidenceId"), sourceReference: text(evidence.sourceReference, "sourceReference"), lineageReferences: uniqueText(evidence.lineageReferences, "lineage reference") });
}

export function createAgentContextSnapshot(input: AgentContextSnapshotInput): AgentContextSnapshot {
  timestamp(input.createdAt, "context createdAt"); timestamp(input.validUntil, "context validUntil");
  if (input.validUntil <= input.createdAt) throw new Error("context validUntil must follow createdAt");
  const normalized = Object.freeze({ ...input, contextSnapshotId: text(input.contextSnapshotId, "contextSnapshotId"), agentId: text(input.agentId, "context agentId"), evidenceIds: uniqueText(input.evidenceIds, "context evidenceId"), policyVersionIds: uniqueText(input.policyVersionIds, "policyVersionId"), certificationIds: uniqueText(input.certificationIds, "certificationId"), controlPlaneStateId: text(input.controlPlaneStateId, "controlPlaneStateId") });
  return Object.freeze({ ...normalized, contextHash: hash(canonical(normalized)) });
}

function verifyContext(context: AgentContextSnapshot, evidence: readonly AgentEvidence[], evaluatedAt: number): readonly string[] {
  const reasons: string[] = [];
  const rebuilt = createAgentContextSnapshot({ contextSnapshotId: context.contextSnapshotId, agentId: context.agentId, evidenceIds: context.evidenceIds, policyVersionIds: context.policyVersionIds, certificationIds: context.certificationIds, controlPlaneStateId: context.controlPlaneStateId, createdAt: context.createdAt, validUntil: context.validUntil });
  if (context.contextHash !== rebuilt.contextHash) reasons.push("CONTEXT_HASH_MISMATCH");
  if (evaluatedAt >= context.validUntil) reasons.push("CONTEXT_STALE");
  const byId = new Map(evidence.map(item => [item.evidenceId, createAgentEvidence(item)]));
  for (const evidenceId of context.evidenceIds) {
    const item = byId.get(evidenceId);
    if (item == null) reasons.push(`CONTEXT_EVIDENCE_MISSING:${evidenceId}`);
    else if (item.quality !== EvidenceQuality.VERIFIED || (item.validUntil != null && evaluatedAt >= item.validUntil)) reasons.push(`CONTEXT_EVIDENCE_UNUSABLE:${evidenceId}`);
  }
  return freeze([...new Set(reasons)].sort());
}

export interface EvidenceReferenceValidation { readonly evidenceId: string; readonly status: EvidenceClaimStatus; }

export function validateEvidenceReferences(references: readonly string[], evidence: readonly AgentEvidence[], evaluatedAt: number): readonly EvidenceReferenceValidation[] {
  timestamp(evaluatedAt, "evidence evaluatedAt");
  const byId = new Map(evidence.map(item => [item.evidenceId, createAgentEvidence(item)]));
  return freeze(uniqueText(references, "evidence reference").map(evidenceId => {
    const item = byId.get(evidenceId);
    if (item == null) return Object.freeze({ evidenceId, status: EvidenceClaimStatus.FABRICATED_REFERENCE });
    if (item.quality === EvidenceQuality.CONFLICTED) return Object.freeze({ evidenceId, status: EvidenceClaimStatus.CONTRADICTED });
    if (item.quality !== EvidenceQuality.VERIFIED || (item.validUntil != null && evaluatedAt >= item.validUntil)) return Object.freeze({ evidenceId, status: EvidenceClaimStatus.UNSUPPORTED });
    return Object.freeze({ evidenceId, status: EvidenceClaimStatus.VERIFIED });
  }));
}

export function assessAgentIndependence(agents: readonly AgentDefinition[]): AgentIndependenceAssessment {
  const normalized = agents.map(createAgentDefinition);
  const countShared = (values: readonly string[]): readonly string[] => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
  };
  const sharedGroups = countShared(normalized.map(agent => agent.correlatedGroupId));
  const sharedModels = countShared(normalized.map(agent => agent.modelVersionId));
  const sharedPrompts = countShared(normalized.map(agent => agent.promptArtifactDigest));
  const shared = [...sharedGroups.map(value => `group:${value}`), ...sharedModels.map(value => `model:${value}`), ...sharedPrompts.map(value => `prompt:${value}`)].sort();
  const reasons = [sharedGroups.length > 0 ? "CORRELATED_AGENT_GROUP" : undefined, sharedModels.length > 0 ? "CORRELATED_MODEL_VERSION" : undefined, sharedPrompts.length > 0 ? "CORRELATED_PROMPT_ARTIFACT" : undefined].filter((value): value is string => value != null);
  return Object.freeze({ agentIds: freeze(normalized.map(agent => agent.agentId).sort()), sharedCorrelatedGroups: freeze(shared), independent: shared.length === 0 && new Set(normalized.map(agent => agent.agentId)).size === normalized.length, reasonCodes: freeze(reasons) });
}

export function evaluateAgentCalibration(agentId: string, evaluationWindow: string, observations: readonly AgentCalibrationObservation[], minimumSamples: number, maximumExpectedCalibrationError: number): AgentCalibrationProfile {
  text(agentId, "calibration agentId"); text(evaluationWindow, "calibration evaluationWindow");
  if (!Number.isSafeInteger(minimumSamples) || minimumSamples < 1 || !Number.isFinite(maximumExpectedCalibrationError) || maximumExpectedCalibrationError < 0 || maximumExpectedCalibrationError > 1) throw new Error("calibration policy is invalid");
  let total = 0;
  for (const observation of observations) {
    if (!Number.isFinite(observation.predictedConfidence) || observation.predictedConfidence < 0 || observation.predictedConfidence > 1) throw new Error("predictedConfidence must be between 0 and 1");
    total += Math.abs(observation.predictedConfidence - (observation.correct ? 1 : 0));
  }
  const error = observations.length === 0 ? undefined : Math.round((total / observations.length) * 1_000_000) / 1_000_000;
  const status = observations.length < minimumSamples ? "insufficient-data" : error! <= maximumExpectedCalibrationError ? "calibrated" : "degraded";
  return Object.freeze({ agentId: agentId.trim(), evaluationWindow: evaluationWindow.trim(), sampleCount: observations.length, expectedCalibrationError: error, calibrationStatus: status });
}

function runReasons(run: AgentRun, agent: AgentDefinition, context: AgentContextSnapshot, evaluatedAt: number): readonly string[] {
  const reasons: string[] = [];
  if (agent.status !== AgentStatus.ACTIVE) reasons.push("AGENT_NOT_ACTIVE");
  if (run.agentId !== agent.agentId || run.agentDefinitionVersion !== agent.definitionVersion || run.modelVersionId !== agent.modelVersionId || run.promptArtifactDigest !== agent.promptArtifactDigest) reasons.push("AGENT_ARTIFACT_MISMATCH");
  if (run.contextSnapshotId !== context.contextSnapshotId) reasons.push("RUN_CONTEXT_MISMATCH");
  if (context.agentId !== agent.agentId) reasons.push("CONTEXT_AGENT_MISMATCH");
  if (run.status !== AgentRunStatus.COMPLETED || run.schemaValidationPassed !== true || run.evidenceValidationPassed !== true || !validHash(run.inputHash) || !validHash(run.outputHash ?? "")) reasons.push("AGENT_RUN_INVALID");
  if (run.startedAt != null && timestamp(run.startedAt, "run startedAt") > evaluatedAt) reasons.push("RUN_TIME_INVALID");
  if (run.completedAt != null && timestamp(run.completedAt, "run completedAt") > evaluatedAt) reasons.push("RUN_TIME_INVALID");
  return freeze([...new Set(reasons)].sort());
}

function expectedOutput(role: AgentRole): string {
  if (role === AgentRole.EVIDENCE_PRODUCER) return "evidence_assessment";
  if (role === AgentRole.STRATEGY_PROPOSER) return "strategy_proposal";
  if (role === AgentRole.ADVERSARIAL_CRITIC) return "adversarial_review";
  if (role === AgentRole.RISK_VERIFIER) return "risk_verification";
  return "observation";
}

function roleReasons(agent: AgentDefinition | undefined, contract: AgentRoleContract | undefined, role: AgentRole): readonly string[] {
  const reasons: string[] = [];
  if (agent == null || agent.role !== role) reasons.push(`ROLE_AGENT_MISSING:${role}`);
  if (contract == null || contract.role !== role || contract.status !== "active" || !contract.permittedOutputs.includes(expectedOutput(role))) reasons.push(`ROLE_CONTRACT_INVALID:${role}`);
  return freeze(reasons.sort());
}

function referenceReasons(references: readonly string[], evidence: readonly AgentEvidence[], at: number): readonly string[] {
  return freeze(validateEvidenceReferences(references, evidence, at).filter(item => item.status !== EvidenceClaimStatus.VERIFIED).map(item => `${item.status.toUpperCase()}:${item.evidenceId}`).sort());
}

function outputEvidenceReasons(assessment: EvidenceAssessment, proposal: StrategyProposal, risk: IndependentRiskVerification, review: AdversarialReview | undefined, evidence: readonly AgentEvidence[], at: number): readonly string[] {
  const reasons = [
    ...referenceReasons(proposal.evidenceReferences, evidence, at),
    ...referenceReasons(risk.evidenceReferences, evidence, at)
  ];
  if (!validHash(assessment.evidenceBundleHash) || !validHash(proposal.proposalHash) || !validHash(risk.verificationHash) || (review != null && !validHash(review.reviewHash))) reasons.push("AGENT_OUTPUT_HASH_INVALID");
  if (!assessment.evidenceAssessmentId.trim() || !proposal.proposalId.trim() || !risk.verificationId.trim() || (review != null && !review.reviewId.trim())) reasons.push("AGENT_OUTPUT_ID_INVALID");
  for (const observation of assessment.observations) {
    if ((observation.claimType === "fact" || observation.claimType === "derived") && observation.evidenceReferences.length === 0) reasons.push("UNSUPPORTED_MATERIAL_CLAIM");
    reasons.push(...referenceReasons(observation.evidenceReferences, evidence, at));
    if (observation.freshnessStatus !== "fresh" && observation.claimType !== "assumption" && observation.claimType !== "unknown") reasons.push("STALE_OR_CONFLICTED_OBSERVATION");
  }
  if (review != null && review.reviewedProposalHash !== proposal.proposalHash) reasons.push("REVIEW_PROPOSAL_HASH_MISMATCH");
  return freeze([...new Set(reasons)].sort());
}

function result(input: MultiAgentDecisionInput, outcome: MultiAgentDecisionResult["result"], vetoes: readonly string[], disagreements: readonly string[]): MultiAgentDecisionResult {
  const policyReferences = freeze([...new Set(input.riskVerification.policyReferences.map(value => text(value, "policy reference")))].sort());
  const seed = { decisionId: input.decisionId, outcome, evidenceAssessmentId: input.evidenceAssessment.evidenceAssessmentId, proposalId: input.proposal.proposalId, reviewId: input.adversarialReview?.reviewId, verificationId: input.riskVerification.verificationId, vetoes, disagreements, policyReferences };
  return Object.freeze({ decisionId: input.decisionId, result: outcome, evidenceAssessmentId: input.evidenceAssessment.evidenceAssessmentId, proposalId: input.proposal.proposalId, adversarialReviewId: input.adversarialReview?.reviewId, riskVerificationId: input.riskVerification.verificationId, vetoReasons: freeze(vetoes), unresolvedDisagreements: freeze(disagreements), policyReferences, decisionPolicyId: "MULTI_AGENT_ZERO_AUTHORITY_V1", decisionHash: hash(canonical(seed)), realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false });
}

/** No vote aggregation: hard vetoes and completeness gates are evaluated before recommendations. */
export function evaluateMultiAgentDecision(input: MultiAgentDecisionInput): MultiAgentDecisionResult {
  text(input.decisionId, "decisionId"); timestamp(input.evaluatedAt, "evaluatedAt");
  const agents = input.agents.map(createAgentDefinition); const contracts = input.roleContracts.map(createAgentRoleContract);
  if (new Set(agents.map(definitionKey)).size !== agents.length) throw new Error("duplicate agent definition version");
  if (new Set(agents.map(agent => agent.role)).size !== agents.length) return result(input, "incomplete", ["DUPLICATE_PROTECTED_AGENT_ROLE"], []);
  const byRole = new Map(agents.map(agent => [agent.role, agent])); const contractsByRole = new Map(contracts.map(contract => [contract.role, contract]));
  const runsById = new Map(input.runs.map(run => [run.agentRunId, run]));
  if (runsById.size !== input.runs.length) return result(input, "incomplete", ["DUPLICATE_AGENT_RUN"], []);
  const contextsById = new Map(input.contexts.map(context => [context.contextSnapshotId, context]));
  if (contextsById.size !== input.contexts.length) return result(input, "incomplete", ["DUPLICATE_CONTEXT_SNAPSHOT"], []);
  const required: Array<[AgentRole, string]> = [[AgentRole.EVIDENCE_PRODUCER, input.evidenceAssessment.agentRunId], [AgentRole.STRATEGY_PROPOSER, input.proposal.agentRunId], [AgentRole.RISK_VERIFIER, input.riskVerification.agentRunId]];
  if (input.adversarialReview != null) required.push([AgentRole.ADVERSARIAL_CRITIC, input.adversarialReview.agentRunId]);
  const completeness: string[] = [];
  const requiredContextIds = new Set<string>();
  const roleAgents: AgentDefinition[] = [];
  for (const [role, runId] of required) {
    const agent = byRole.get(role); const run = runsById.get(runId);
    completeness.push(...roleReasons(agent, contractsByRole.get(role), role));
    if (agent != null) roleAgents.push(agent);
    if (agent == null || run == null) completeness.push(`RUN_MISSING:${role}`);
    else {
      const context = contextsById.get(run.contextSnapshotId);
      if (context == null) completeness.push(`CONTEXT_MISSING:${role}`);
      else { requiredContextIds.add(context.contextSnapshotId); completeness.push(...verifyContext(context, input.evidence, input.evaluatedAt), ...runReasons(run, agent, context, input.evaluatedAt)); }
    }
  }
  if (requiredContextIds.size !== required.length) completeness.push("CONTEXT_NOT_ISOLATED");
  const independence = assessAgentIndependence(roleAgents);
  if (!independence.independent) completeness.push(...independence.reasonCodes);
  const outputReasons = outputEvidenceReasons(input.evidenceAssessment, input.proposal, input.riskVerification, input.adversarialReview, input.evidence, input.evaluatedAt);
  if (outputReasons.some(reason => reason.startsWith("FABRICATED_REFERENCE:"))) return result(input, "deny", ["EVIDENCE_INTEGRITY_FAILURE", ...outputReasons.filter(reason => reason.startsWith("FABRICATED_REFERENCE:"))].sort(), []);
  completeness.push(...outputReasons);
  if (input.evidenceAssessment.missingEvidence.length > 0) completeness.push("EVIDENCE_DECLARED_MISSING");
  const unresolved = input.disagreements.filter(item => item.unresolved).filter(item => item.severity === "high" || item.severity === "critical").map(item => item.disagreementId).sort();
  const hardVetoes = [...input.controlVetoReasons.map(value => text(value, "control veto")), ...input.riskVerification.hardDenies.map(value => text(value, "risk hard deny"))].sort();
  if (input.riskVerification.result === "denied") hardVetoes.push("RISK_VERIFIER_DENIED");
  if (hardVetoes.length > 0) return result(input, "deny", [...new Set(hardVetoes)].sort(), unresolved);
  if (input.riskVerification.result !== "verified" || completeness.length > 0) return result(input, "incomplete", [...new Set(completeness)].sort(), unresolved);
  if (unresolved.length > 0 || input.adversarialReview?.severity === "critical") return result(input, "escalation_required", [], unresolved);
  if (input.proposal.decision === "no_action" || input.proposal.decision === "insufficient_evidence") return result(input, "no_action", [], []);
  return result(input, "preview_candidate", [], []);
}

function normalizeEvent(event: MultiAgentGovernanceEvent): MultiAgentGovernanceEvent {
  text(event.eventId, "eventId"); timestamp(event.occurredAt, "event occurredAt");
  if (!validHash(event.evidenceHash)) throw new Error("event evidenceHash must be sha256");
  return Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) });
}
const eventHash = (sequence: number, previousHash: string, event: MultiAgentGovernanceEvent): string => hash(`${sequence}\n${previousHash}\n${canonical(event)}`);

export interface MultiAgentGovernanceReplayState {
  readonly hash: string;
  readonly agents: ReadonlyMap<string, AgentDefinition>;
  readonly evidence: ReadonlyMap<string, AgentEvidence>;
  readonly contexts: ReadonlyMap<string, AgentContextSnapshot>;
  readonly decisions: ReadonlyMap<string, MultiAgentDecisionResult>;
}

export function replayMultiAgentGovernance(records: readonly MultiAgentGovernanceRecord[]): MultiAgentGovernanceReplayState {
  let previousHash = genesis; let previousTime = -1;
  const agents = new Map<string, AgentDefinition>(); const evidence = new Map<string, AgentEvidence>(); const contexts = new Map<string, AgentContextSnapshot>(); const decisions = new Map<string, MultiAgentDecisionResult>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!; const event = normalizeEvent(record.event);
    if (record.sequence !== index + 1 || record.previousHash !== previousHash || record.hash !== eventHash(record.sequence, record.previousHash, event)) throw new Error("multi-agent ledger integrity violation");
    if (event.occurredAt < previousTime) throw new Error("multi-agent ledger timestamp regression");
    if (event.type === MultiAgentGovernanceEventType.AGENT_REGISTERED || event.type === MultiAgentGovernanceEventType.AGENT_ACTIVATED || event.type === MultiAgentGovernanceEventType.AGENT_SUSPENDED) {
      const agent = createAgentDefinition(event.payload.agent as AgentDefinition); const key = definitionKey(agent); const current = agents.get(key);
      if (current != null && canonical(current) !== canonical(agent)) throw new Error("agent definition conflict");
      agents.set(key, agent);
    }
    if (event.type === MultiAgentGovernanceEventType.AGENT_EVIDENCE_REGISTERED) {
      const item = createAgentEvidence(event.payload.evidence as AgentEvidence);
      if (evidence.has(item.evidenceId)) throw new Error("agent evidence is immutable"); evidence.set(item.evidenceId, item);
    }
    if (event.type === MultiAgentGovernanceEventType.AGENT_CONTEXT_SNAPSHOT_CREATED) {
      const context = event.payload.context as AgentContextSnapshot;
      const verified = createAgentContextSnapshot({ contextSnapshotId: context.contextSnapshotId, agentId: context.agentId, evidenceIds: context.evidenceIds, policyVersionIds: context.policyVersionIds, certificationIds: context.certificationIds, controlPlaneStateId: context.controlPlaneStateId, createdAt: context.createdAt, validUntil: context.validUntil });
      if (verified.contextHash !== context.contextHash || contexts.has(context.contextSnapshotId)) throw new Error("context snapshot integrity violation"); contexts.set(context.contextSnapshotId, verified);
    }
    if (event.type === MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_EVALUATED || event.type === MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_DENIED) {
      const decision = event.payload.decision as MultiAgentDecisionResult;
      if (decision == null || decisions.has(decision.decisionId) || decision.realOrderAuthority !== false || decision.realTransferAuthority !== false || decision.productionMutationAllowed !== false || !validHash(decision.decisionHash)) throw new Error("invalid multi-agent decision event");
      decisions.set(decision.decisionId, Object.freeze({ ...decision, vetoReasons: freeze(decision.vetoReasons), unresolvedDisagreements: freeze(decision.unresolvedDisagreements), policyReferences: freeze(decision.policyReferences) }));
    }
    previousHash = record.hash; previousTime = event.occurredAt;
  }
  return Object.freeze({ hash: previousHash, agents, evidence, contexts, decisions });
}

export function appendMultiAgentGovernanceEvent(records: readonly MultiAgentGovernanceRecord[], event: MultiAgentGovernanceEvent): readonly MultiAgentGovernanceRecord[] {
  replayMultiAgentGovernance(records); const normalized = normalizeEvent(event); const previousHash = records.at(-1)?.hash ?? genesis;
  const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: eventHash(records.length + 1, previousHash, normalized) });
  const next = Object.freeze([...records, record]); replayMultiAgentGovernance(next); return next;
}
