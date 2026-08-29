import {
  AgentRole,
  AgentRunStatus,
  AgentStatus,
  type AgentContextSnapshot,
  type AgentDefinition,
  type AgentEvidence,
  type AgentIndependenceAssessment,
  type AgentRoleContract,
  type AgentRun,
  type EvidenceAssessment,
  type EvidenceObservation,
  type IndependentRiskVerification,
  type MultiAgentDecisionResult,
  type AdversarialReview,
  type StrategyProposal,
  type MultiAgentGovernanceEvent,
  MultiAgentGovernanceEventType
} from "../../../../packages/contracts/src/multiAgentGovernance";
import { aiSha256, normalizeAiLearningProvenance, type AiAgentRole, type AiEvidenceMaterialization, type ModelFailure, type ModelProvider, type ModelRequest, type StructuredAgentOutput } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceBudgetPolicy, AiInferenceResourceSnapshot } from "../../../../packages/contracts/src/aiInferenceResources";
import { assessAgentIndependence, createAgentDefinition, evaluateMultiAgentDecision } from "../multiAgentGovernance";
import { AgentExecutor } from "./agentExecutor";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";
import { aiInferenceBudgetIdentity, InferenceResourceLedger, normalizeAiInferenceBudgetPolicy } from "./inferenceResourceLedger";
import { createDefaultPromptArtifactRegistry, type PromptArtifactRegistry } from "./promptArtifactRegistry";

export interface GovernanceEventSink { append(event: MultiAgentGovernanceEvent): unknown; }

export interface AiOrchestrationInput {
  readonly orchestrationRunId: string;
  readonly decisionId: string;
  /** Evidence/context snapshot time. Final governance evaluation advances to the latest completed model run. */
  readonly evaluatedAt: number;
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceMaterializations?: readonly AiEvidenceMaterialization[];
  readonly policyVersionIds?: readonly string[];
  readonly certificationIds?: readonly string[];
  readonly controlPlaneStateId?: string;
  readonly contextValidForMs?: number;
  /** Explicit trusted trigger evidence. Omitted or malformed values remain UNKNOWN. */
  readonly learningProvenance?: import("../../../../packages/contracts/src/aiInference").AiLearningProvenance;
}

export interface AiOrchestrationResult {
  readonly status: "COMPLETED" | "UNAVAILABLE" | "INCOMPLETE";
  readonly orchestrationRunId: string;
  readonly learningProvenance: import("../../../../packages/contracts/src/aiInference").AiLearningProvenance;
  readonly governanceDecision: MultiAgentDecisionResult | null;
  readonly independence: AgentIndependenceAssessment | null;
  readonly agents: readonly AgentDefinition[];
  readonly contexts: readonly AgentContextSnapshot[];
  readonly runs: readonly AgentRun[];
  readonly failureCodes: readonly ModelFailure["code"][];
  readonly outputHashes: readonly string[];
  readonly structuredOutputs: readonly StructuredAgentOutput[];
  /** Provider-neutral read-only run resource evidence. Older synthetic fixtures may omit it. */
  readonly inferenceResources?: AiInferenceResourceSnapshot;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}

export interface MultiAgentOrchestratorOptions {
  readonly enabled?: boolean;
  readonly promptRegistry?: PromptArtifactRegistry;
  readonly maxRetries?: number;
  readonly eventSink?: GovernanceEventSink;
  readonly resourcePolicy?: AiInferenceBudgetPolicy;
  readonly now?: () => number;
}

const roles: readonly AiAgentRole[] = ["EVIDENCE_PRODUCER", "STRATEGY_PROPOSER", "ADVERSARIAL_CRITIC", "RISK_VERIFIER"];
const roleMap: Readonly<Record<AiAgentRole, AgentRole>> = Object.freeze({ EVIDENCE_PRODUCER: AgentRole.EVIDENCE_PRODUCER, STRATEGY_PROPOSER: AgentRole.STRATEGY_PROPOSER, ADVERSARIAL_CRITIC: AgentRole.ADVERSARIAL_CRITIC, RISK_VERIFIER: AgentRole.RISK_VERIFIER });
const outputName: Readonly<Record<AiAgentRole, string>> = Object.freeze({ EVIDENCE_PRODUCER: "evidence_assessment", STRATEGY_PROPOSER: "strategy_proposal", ADVERSARIAL_CRITIC: "adversarial_review", RISK_VERIFIER: "risk_verification" });

const text = (value: unknown, field: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value.trim(); };
const strings = (value: unknown, field: string): readonly string[] => { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be a string array`); return Object.freeze([...new Set(value as string[])].map((item) => item.trim()).sort()); };
const boundedProbability = (value: unknown, field: string): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be finite and within [0,1]`); return value; };
const observations = (value: unknown): readonly EvidenceObservation[] => {
  if (!Array.isArray(value)) throw new Error("observations must be an array");
  return Object.freeze(value.map((item) => {
    if (item == null || typeof item !== "object") throw new Error("observation must be an object");
    const observation = item as Record<string, unknown>;
    if (!["fact", "derived", "assumption", "unknown"].includes(String(observation.claimType))) throw new Error("observation claimType is invalid");
    if (!["fresh", "stale", "conflicted", "unknown"].includes(String(observation.freshnessStatus))) throw new Error("observation freshnessStatus is invalid");
    return Object.freeze({ claim: text(observation.claim, "observation claim"), claimType: observation.claimType as EvidenceObservation["claimType"], evidenceReferences: strings(observation.evidenceReferences, "observation evidenceReferences"), confidence: observation.confidence == null ? undefined : text(observation.confidence, "observation confidence"), freshnessStatus: observation.freshnessStatus as EvidenceObservation["freshnessStatus"] });
  }));
};
const allowedPayloadKeys: Readonly<Record<AiAgentRole, readonly string[]>> = Object.freeze({
  EVIDENCE_PRODUCER: ["observations", "missingEvidence", "evidenceBundleHash"],
  STRATEGY_PROPOSER: ["strategyVersionId", "decision", "rationaleClaims", "assumptions", "uncertainty", "rawProbability", "expectedEffect", "costSensitivity", "capacitySensitivity"],
  ADVERSARIAL_CRITIC: ["reviewedProposalHash", "counterClaims", "failedAssumptions", "missingTests", "alternativeExplanations", "severity"],
  RISK_VERIFIER: ["result", "hardDenies", "warnings", "missingRequirements", "requiredEscalations", "policyReferences"]
});
const validatePayloadKeys = (role: AiAgentRole, payload: Record<string, unknown>): void => {
  const allowed = new Set(allowedPayloadKeys[role]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("structured output schema violation");
};
const payloadOf = (value: unknown, role: AiAgentRole): { evidenceReferences: readonly string[]; payload: Record<string, unknown> } => {
  if (value == null || typeof value !== "object") throw new Error("structured output must be an object");
  const output = value as Partial<StructuredAgentOutput>;
  if (output.schemaVersion !== 1 || output.role !== role || !Array.isArray(output.evidenceReferences) || output.payload == null || typeof output.payload !== "object") throw new Error("structured output schema violation");
  const payload = output.payload as Record<string, unknown>;
  validatePayloadKeys(role, payload);
  return { evidenceReferences: strings(output.evidenceReferences, "evidenceReferences"), payload };
};

const validateRoleOutput = (role: AiAgentRole, value: unknown): StructuredAgentOutput => {
  const { evidenceReferences, payload } = payloadOf(value, role);
  if (role === "EVIDENCE_PRODUCER") { if (typeof payload.evidenceBundleHash !== "string" || !/^[a-f0-9]{64}$/i.test(payload.evidenceBundleHash)) throw new Error("evidenceBundleHash must be sha256"); strings(payload.missingEvidence ?? [], "missingEvidence"); observations(payload.observations); }
  if (role === "STRATEGY_PROPOSER") { if (!["candidate", "no_action", "insufficient_evidence"].includes(String(payload.decision))) throw new Error("strategy decision is invalid"); text(payload.uncertainty, "uncertainty"); strings(payload.rationaleClaims, "rationaleClaims"); strings(payload.assumptions ?? [], "assumptions"); boundedProbability(payload.rawProbability, "rawProbability"); }
  if (role === "ADVERSARIAL_CRITIC") { if (!["none", "low", "medium", "high", "critical"].includes(String(payload.severity))) throw new Error("critic severity is invalid"); strings(payload.counterClaims ?? [], "counterClaims"); strings(payload.failedAssumptions ?? [], "failedAssumptions"); strings(payload.missingTests ?? [], "missingTests"); strings(payload.alternativeExplanations ?? [], "alternativeExplanations"); text(payload.reviewedProposalHash, "reviewedProposalHash"); }
  if (role === "RISK_VERIFIER") { if (!["verified", "denied", "incomplete"].includes(String(payload.result))) throw new Error("risk result is invalid"); strings(payload.hardDenies ?? [], "hardDenies"); strings(payload.warnings ?? [], "warnings"); strings(payload.missingRequirements ?? [], "missingRequirements"); strings(payload.requiredEscalations ?? [], "requiredEscalations"); strings(payload.policyReferences, "policyReferences"); }
  return Object.freeze({ schemaVersion: 1, role, evidenceReferences, payload: Object.freeze({ ...payload }) });
};

const contract = (role: AgentRole, output: string, id: string): AgentRoleContract => Object.freeze({ contractId: `ai-contract-${id}`, role, requiredInputs: ["evidence_context"], permittedOutputs: [output], prohibitedOutputs: ["order", "cancel", "transfer", "withdraw", "credential", "secret", "production_mutation", "live_execution"], evidenceRequirements: ["verified"], timeoutBehavior: "incomplete", fallbackPolicyId: "AI_ZERO_AUTHORITY_FAIL_CLOSED_V1", status: "active" });

const failureResult = (input: AiOrchestrationInput, status: "UNAVAILABLE" | "INCOMPLETE", agents: readonly AgentDefinition[] = [], contexts: readonly AgentContextSnapshot[] = [], runs: readonly AgentRun[] = [], failureCodes: readonly ModelFailure["code"][] = [], inferenceResources?: AiInferenceResourceSnapshot): AiOrchestrationResult => Object.freeze({ status, orchestrationRunId: input.orchestrationRunId, learningProvenance: normalizeAiLearningProvenance(input.learningProvenance), governanceDecision: null, independence: agents.length ? assessAgentIndependence(agents) : null, agents, contexts, runs, failureCodes: Object.freeze([...failureCodes]), outputHashes: Object.freeze([]), structuredOutputs: Object.freeze([]), ...(inferenceResources == null ? {} : { inferenceResources }), liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false });

const evidenceFailureCode = (error: unknown): ModelFailure["code"] => {
  const message = error instanceof Error ? error.message : String(error);
  if (/materialization is missing/i.test(message)) return "EVIDENCE_MISSING";
  if (/digest mismatch/i.test(message)) return "EVIDENCE_DIGEST_MISMATCH";
  if (/credential material/i.test(message)) return "SENSITIVE_EVIDENCE";
  return "CONTEXT_INVALID";
};

export class MultiAgentOrchestrator {
  private readonly cache = new Map<string, { inputHash: string; result: AiOrchestrationResult }>();
  private readonly registry: PromptArtifactRegistry;
  private readonly enabled: boolean;
  private readonly eventSink?: GovernanceEventSink;
  private readonly maxRetries: number;
  private readonly resourcePolicy: AiInferenceBudgetPolicy;
  private readonly now: () => number;

  public constructor(private readonly provider: ModelProvider, options: MultiAgentOrchestratorOptions = {}) {
    this.enabled = options.enabled === true;
    this.eventSink = options.eventSink;
    this.registry = options.promptRegistry ?? createDefaultPromptArtifactRegistry();
    this.maxRetries = options.maxRetries ?? 1;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 2) throw new Error("AI retry policy is invalid");
    this.resourcePolicy = normalizeAiInferenceBudgetPolicy(options.resourcePolicy);
    this.now = options.now ?? Date.now;
  }

  public async run(input: AiOrchestrationInput): Promise<AiOrchestrationResult> {
    const resourceStartedAt = this.now();
    let resourceLedger: InferenceResourceLedger;
    try { resourceLedger = new InferenceResourceLedger(this.resourcePolicy, resourceStartedAt); }
    catch { return failureResult(input, "INCOMPLETE", [], [], [], ["CONTEXT_INVALID"]); }
    const resourceSnapshot = (): AiInferenceResourceSnapshot => resourceLedger.snapshot(this.now());
    let inputHash: string;
    try {
      const promptIdentity = roles.map((role) => {
        const artifact = this.registry.get(`nusa.ai.${role.toLowerCase()}`, "1.0.0");
        return artifact == null ? { role, missing: true } : { role, promptArtifactId: artifact.promptArtifactId, version: artifact.version, digest: artifact.digest };
      });
      inputHash = aiSha256({
        decisionId: input.decisionId,
        evidence: [...input.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
        evidenceMaterializations: [...(input.evidenceMaterializations ?? [])].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
        evaluatedAt: input.evaluatedAt,
        policyVersionIds: [...(input.policyVersionIds ?? [])].sort(),
        certificationIds: [...(input.certificationIds ?? [])].sort(),
        controlPlaneStateId: input.controlPlaneStateId ?? "",
        contextValidForMs: input.contextValidForMs ?? 60_000,
        learningProvenance: normalizeAiLearningProvenance(input.learningProvenance),
        providerId: this.provider.providerId,
        modelVersionId: this.provider.modelVersionId,
        promptIdentity,
        inferenceResourceBudget: aiInferenceBudgetIdentity(this.resourcePolicy)
      });
    } catch { return failureResult(input, "INCOMPLETE", [], [], [], ["CONTEXT_INVALID"], resourceSnapshot()); }
    const prior = this.cache.get(input.orchestrationRunId);
    if (prior != null) return prior.inputHash === inputHash ? prior.result : failureResult(input, "INCOMPLETE", [], [], [], ["REPLAY_CONFLICT"], resourceSnapshot());
    if (!this.enabled) return failureResult(input, "UNAVAILABLE", [], [], [], ["PROVIDER_UNAVAILABLE"], resourceSnapshot());
    const executor = new AgentExecutor(this.provider, this.maxRetries, resourceLedger, this.now);
    const agents = roles.map((role) => this.definition(role));
    const contexts: AgentContextSnapshot[] = [];
    const runs: AgentRun[] = [];
    const outputHashes: string[] = [];
    const failures: ModelFailure["code"][] = [];
    const outputs = new Map<AiAgentRole, StructuredAgentOutput>();
    const contextValidForMs = input.contextValidForMs ?? 60_000;
    for (const role of roles) {
      const definition = agents.find((agent) => agent.role === roleMap[role])!;
      const callId = `${input.orchestrationRunId}:call:${role}`;
      if (!resourceLedger.reserveCall(callId, this.now())) {
        failures.push("CONTEXT_INVALID");
        return this.cacheAndReturn(input, inputHash, failureResult(input, "INCOMPLETE", agents, contexts, runs, failures, resourceSnapshot()));
      }
      let bundle;
      try {
        bundle = buildEvidenceBundle({ contextSnapshotId: `${input.orchestrationRunId}:context:${role}`, agentId: definition.agentId, evidence: input.evidence, evidenceMaterializations: input.evidenceMaterializations ?? [], allowedEvidenceClasses: definition.allowedEvidenceClasses, evaluatedAt: input.evaluatedAt, validUntil: input.evaluatedAt + contextValidForMs, policyVersionIds: input.policyVersionIds ?? ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: input.certificationIds ?? [], controlPlaneStateId: input.controlPlaneStateId ?? "AI_CONTROL_PLANE_UNAVAILABLE" });
      } catch (error) { return this.cacheAndReturn(input, inputHash, failureResult(input, "INCOMPLETE", agents, contexts, runs, [evidenceFailureCode(error)], resourceSnapshot())); }
      contexts.push(bundle.context);
      let artifact;
      try { artifact = this.registry.assertDefinition(definition.promptArtifactId, definition.definitionVersion, definition.promptArtifactDigest); } catch { return this.cacheAndReturn(input, inputHash, failureResult(input, "INCOMPLETE", agents, contexts, runs, ["PROMPT_DIGEST_MISMATCH"], resourceSnapshot())); }
      const modelVersionId = this.provider.modelVersionId;
      const proposalOutput = outputs.get("STRATEGY_PROPOSER");
      const proposalPayload = proposalOutput?.payload;
      const proposalPreviewHash = proposalPayload == null || proposalOutput == null ? undefined : aiSha256({ strategyVersionId: text(proposalPayload.strategyVersionId ?? "ai-preview", "strategyVersionId"), decision: proposalPayload.decision, rationaleClaims: strings(proposalPayload.rationaleClaims, "rationaleClaims"), evidenceReferences: proposalOutput.evidenceReferences, assumptions: strings(proposalPayload.assumptions ?? [], "assumptions"), uncertainty: text(proposalPayload.uncertainty, "uncertainty"), expectedEffect: proposalPayload.expectedEffect, costSensitivity: proposalPayload.costSensitivity, capacitySensitivity: proposalPayload.capacitySensitivity });
      const modelInput = Object.freeze({ role, contextHash: bundle.context.contextHash, evidenceBundleHash: bundle.evidenceBundleHash, evidence: bundle.materializedEvidence.map((item) => Object.freeze({ evidenceId: item.evidence.evidenceId, evidenceType: item.evidence.evidenceType, observedAt: item.evidence.observedAt, validUntil: item.evidence.validUntil, quality: item.evidence.quality, contentDigest: item.evidence.contentDigest, payload: item.payload })), ...(proposalPreviewHash == null ? {} : { proposalHash: proposalPreviewHash }) });
      const request: ModelRequest = Object.freeze({ requestId: `${input.orchestrationRunId}:request:${role}`, role, providerId: this.provider.providerId, modelVersionId, promptArtifactId: artifact.promptArtifactId, promptArtifactVersion: artifact.version, promptArtifactDigest: artifact.digest, instructions: artifact.instructions, contextHash: bundle.context.contextHash, inputHash: aiSha256(modelInput), input: modelInput, maxOutputBytes: 32_768, maxTokens: 2_048, timeoutMs: 10_000, attempt: 0 });
      const execution = await executor.execute(request, (value) => validateRoleOutput(role, value));
      if (!execution.ok) { failures.push(execution.failure.code); runs.push(this.failedRun(input, definition, bundle.context, request, execution.failure)); return this.cacheAndReturn(input, inputHash, failureResult(input, execution.failure.code === "PROVIDER_UNAVAILABLE" ? "UNAVAILABLE" : "INCOMPLETE", agents, contexts, runs, failures, resourceSnapshot())); }
      if (role === "EVIDENCE_PRODUCER" && execution.output.payload.evidenceBundleHash !== bundle.evidenceBundleHash) { failures.push("EVIDENCE_DIGEST_MISMATCH"); return this.cacheAndReturn(input, inputHash, failureResult(input, "INCOMPLETE", agents, contexts, runs, failures, resourceSnapshot())); }
      outputs.set(role, execution.output); outputHashes.push(execution.outputHash); runs.push(this.completedRun(input, definition, bundle.context, request, execution.outputHash, execution.response.startedAt, execution.response.completedAt));
      this.appendRunEvents(input, definition, bundle.evidence, bundle.context, runs.at(-1)!);
    }
    const assessment = this.toAssessment(outputs.get("EVIDENCE_PRODUCER")!, runs.find((run) => run.agentId === "ai-evidence-producer")!);
    const proposal = this.toProposal(outputs.get("STRATEGY_PROPOSER")!, runs.find((run) => run.agentId === "ai-strategy-proposer")!);
    const review = this.toReview(outputs.get("ADVERSARIAL_CRITIC")!, runs.find((run) => run.agentId === "ai-adversarial-critic")!, proposal.proposalHash);
    const risk = this.toRisk(outputs.get("RISK_VERIFIER")!, runs.find((run) => run.agentId === "ai-risk-verifier")!);
    const independence = assessAgentIndependence(agents);
    const governanceEvaluatedAt = runs.reduce((latest, run) => run.completedAt == null ? latest : Math.max(latest, run.completedAt), input.evaluatedAt);
    const decision = evaluateMultiAgentDecision({ decisionId: input.decisionId, evaluatedAt: governanceEvaluatedAt, agents, roleContracts: roles.map((role) => contract(roleMap[role], outputName[role], role.toLowerCase())), evidence: input.evidence, contexts, runs, evidenceAssessment: assessment, proposal, adversarialReview: review, riskVerification: risk, disagreements: [], controlVetoReasons: [] });
    this.eventSink?.append({ eventId: `${input.orchestrationRunId}:decision`, type: decision.result === "deny" ? MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_DENIED : MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_EVALUATED, occurredAt: governanceEvaluatedAt, payload: { decision, independence }, evidenceHash: aiSha256({ decision, independence }) });
    return this.cacheAndReturn(input, inputHash, Object.freeze({ status: "COMPLETED", orchestrationRunId: input.orchestrationRunId, learningProvenance: normalizeAiLearningProvenance(input.learningProvenance), governanceDecision: decision, independence, agents: Object.freeze(agents), contexts: Object.freeze(contexts), runs: Object.freeze(runs), failureCodes: Object.freeze(failures), outputHashes: Object.freeze(outputHashes), structuredOutputs: Object.freeze([...outputs.values()]), inferenceResources: resourceSnapshot(), liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false }));
  }

  private definition(role: AiAgentRole): AgentDefinition {
    const artifact = this.registry.get(`nusa.ai.${role.toLowerCase()}`, "1.0.0")!;
    const enumRole = roleMap[role];
    return createAgentDefinition({ agentId: `ai-${role.toLowerCase().replaceAll("_", "-")}`, name: `NUSA ${role}`, role: enumRole, definitionVersion: artifact.version, modelVersionId: this.provider.modelVersionId, modelCertificationId: `model-cert:${this.provider.providerId}:${this.provider.modelVersionId}`, promptArtifactId: artifact.promptArtifactId, promptArtifactDigest: artifact.digest, inputSchemaId: artifact.inputSchemaId, outputSchemaId: artifact.outputSchemaId, allowedEvidenceClasses: artifact.allowedEvidenceClasses, allowedToolCapabilities: ["READ_EVIDENCE"], contextIsolationPolicyId: "AI_EVIDENCE_CONTEXT_ISOLATION_V1", timeoutPolicyId: "AI_BOUNDED_TIMEOUT_V1", correlatedGroupId: `model:${this.provider.providerId}:${this.provider.modelVersionId}`, status: AgentStatus.ACTIVE });
  }

  private completedRun(input: AiOrchestrationInput, definition: AgentDefinition, context: AgentContextSnapshot, request: ModelRequest, outputHash: string, startedAt: number, completedAt: number): AgentRun { return Object.freeze({ agentRunId: `${input.orchestrationRunId}:run:${definition.agentId}`, agentId: definition.agentId, orchestrationRunId: input.orchestrationRunId, agentDefinitionVersion: definition.definitionVersion, modelVersionId: definition.modelVersionId, promptArtifactDigest: definition.promptArtifactDigest, contextSnapshotId: context.contextSnapshotId, inputHash: request.inputHash, outputHash, status: AgentRunStatus.COMPLETED, schemaValidationPassed: true, evidenceValidationPassed: true, startedAt, completedAt }); }
  private failedRun(input: AiOrchestrationInput, definition: AgentDefinition, context: AgentContextSnapshot, request: ModelRequest, _error: ModelFailure): AgentRun { return Object.freeze({ agentRunId: `${input.orchestrationRunId}:run:${definition.agentId}`, agentId: definition.agentId, orchestrationRunId: input.orchestrationRunId, agentDefinitionVersion: definition.definitionVersion, modelVersionId: definition.modelVersionId, promptArtifactDigest: definition.promptArtifactDigest, contextSnapshotId: context.contextSnapshotId, inputHash: request.inputHash, status: AgentRunStatus.FAILED, schemaValidationPassed: false, evidenceValidationPassed: false, startedAt: input.evaluatedAt, completedAt: input.evaluatedAt }); }
  private appendRunEvents(input: AiOrchestrationInput, definition: AgentDefinition, evidence: readonly AgentEvidence[], context: AgentContextSnapshot, run: AgentRun): void { if (this.eventSink == null) return; this.eventSink.append({ eventId: `${input.orchestrationRunId}:agent:${definition.agentId}`, type: MultiAgentGovernanceEventType.AGENT_RUN_COMPLETED, occurredAt: run.completedAt ?? input.evaluatedAt, payload: { agent: definition, evidence, context, run }, evidenceHash: aiSha256({ evidence, context, run }) }); }
  private cacheAndReturn(input: AiOrchestrationInput, inputHash: string, result: AiOrchestrationResult): AiOrchestrationResult { this.cache.set(input.orchestrationRunId, { inputHash, result }); return result; }
  private toAssessment(output: StructuredAgentOutput, run: AgentRun): EvidenceAssessment { const payload = output.payload; return Object.freeze({ evidenceAssessmentId: `${run.agentRunId}:assessment`, agentRunId: run.agentRunId, observations: observations(payload.observations), missingEvidence: strings(payload.missingEvidence ?? [], "missingEvidence"), evidenceBundleHash: typeof payload.evidenceBundleHash === "string" && /^[a-f0-9]{64}$/i.test(payload.evidenceBundleHash) ? payload.evidenceBundleHash : aiSha256(output) }); }
  private toProposal(output: StructuredAgentOutput, run: AgentRun): StrategyProposal { const p = output.payload; const seed = { strategyVersionId: text(p.strategyVersionId ?? "ai-preview", "strategyVersionId"), decision: p.decision, rationaleClaims: strings(p.rationaleClaims, "rationaleClaims"), evidenceReferences: output.evidenceReferences, assumptions: strings(p.assumptions ?? [], "assumptions"), uncertainty: text(p.uncertainty, "uncertainty"), expectedEffect: p.expectedEffect, costSensitivity: p.costSensitivity, capacitySensitivity: p.capacitySensitivity }; return Object.freeze({ proposalId: `${run.agentRunId}:proposal`, agentRunId: run.agentRunId, ...seed, proposalHash: aiSha256(seed) } as StrategyProposal); }
  private toReview(output: StructuredAgentOutput, run: AgentRun, proposalHash: string): AdversarialReview { const p = output.payload; const reviewed = text(p.reviewedProposalHash, "reviewedProposalHash"); return Object.freeze({ reviewId: `${run.agentRunId}:review`, agentRunId: run.agentRunId, reviewedProposalHash: reviewed, counterClaims: strings(p.counterClaims ?? [], "counterClaims"), failedAssumptions: strings(p.failedAssumptions ?? [], "failedAssumptions"), missingTests: strings(p.missingTests ?? [], "missingTests"), alternativeExplanations: strings(p.alternativeExplanations ?? [], "alternativeExplanations"), severity: p.severity as AdversarialReview["severity"], reviewHash: aiSha256({ reviewedProposalHash: proposalHash, counterClaims: p.counterClaims ?? [], failedAssumptions: p.failedAssumptions ?? [], missingTests: p.missingTests ?? [], alternativeExplanations: p.alternativeExplanations ?? [], severity: p.severity }) }); }
  private toRisk(output: StructuredAgentOutput, run: AgentRun): IndependentRiskVerification { const p = output.payload; const seed = { result: p.result, hardDenies: strings(p.hardDenies ?? [], "hardDenies"), warnings: strings(p.warnings ?? [], "warnings"), missingRequirements: strings(p.missingRequirements ?? [], "missingRequirements"), requiredEscalations: strings(p.requiredEscalations ?? [], "requiredEscalations"), policyReferences: strings(p.policyReferences, "policyReferences"), evidenceReferences: output.evidenceReferences }; return Object.freeze({ verificationId: `${run.agentRunId}:risk`, agentRunId: run.agentRunId, ...seed, verificationHash: aiSha256(seed) } as IndependentRiskVerification); }
}

