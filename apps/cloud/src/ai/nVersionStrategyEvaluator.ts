import {
  aiSha256,
  type AiEvidenceMaterialization,
  type ModelProvider,
  type ModelRequest,
  type StructuredAgentOutput
} from "../../../../packages/contracts/src/aiInference";
import type {
  AiProviderComparisonResult,
  AiProviderDisagreementMetrics,
  AiProviderGroupComparisonEvidence,
  AiProviderGroupPolicy,
  AiProviderPoolPolicy,
  AiProviderStrategyProjection
} from "../../../../packages/contracts/src/aiProviderDiversity";
import type { AgentEvidence } from "../../../../packages/contracts/src/multiAgentGovernance";
import { AgentExecutor } from "./agentExecutor";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";
import { aiInferenceBudgetIdentity, InferenceResourceLedger, normalizeAiInferenceBudgetPolicy } from "./inferenceResourceLedger";
import { createDefaultPromptArtifactRegistry, type PromptArtifactRegistry } from "./promptArtifactRegistry";

export interface AiProviderRegistration {
  readonly groupId: string;
  readonly provider: ModelProvider;
}

export interface NVersionStrategyInput {
  readonly comparisonRunId: string;
  readonly decisionId: string;
  readonly evaluatedAt: number;
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceMaterializations?: readonly AiEvidenceMaterialization[];
  readonly policyVersionIds?: readonly string[];
  readonly certificationIds?: readonly string[];
  readonly controlPlaneStateId?: string;
  readonly contextValidForMs?: number;
}

export interface NVersionStrategyEvaluatorOptions {
  readonly promptRegistry?: PromptArtifactRegistry;
  readonly maxRetries?: number;
  readonly now?: () => number;
}

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const boundedUnit = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be within [0,1]`);
  return value;
};

const positiveSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const normalizedProviderId = (value: unknown): string => requiredText(value, "providerId").toLowerCase();
const normalizedFamilyId = (value: unknown): string => requiredText(value, "modelFamilyId").toLowerCase();
const normalizedComparableText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizedStrings = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new Error(`${field} must be a string array`);
  return Object.freeze([...new Set((value as string[]).map((item) => item.trim()))].sort());
};

export function normalizeAiProviderPoolPolicy(value: AiProviderPoolPolicy): AiProviderPoolPolicy {
  if (value.schemaVersion !== 1) throw new Error("AI provider pool schemaVersion is unsupported");
  const policyId = requiredText(value.policyId, "AI provider pool policyId");
  const policyVersion = requiredText(value.policyVersion, "AI provider pool policyVersion");
  if (!Array.isArray(value.groups) || value.groups.length < 1 || value.groups.length > 4) throw new Error("AI provider pool groups must contain 1..4 entries");
  const groupIds = new Set<string>();
  const groups = value.groups.map((group): AiProviderGroupPolicy => {
    const groupId = requiredText(group.groupId, "AI provider groupId");
    if (groupIds.has(groupId)) throw new Error("AI provider groupId must be unique");
    groupIds.add(groupId);
    return Object.freeze({
      groupId,
      providerId: normalizedProviderId(group.providerId),
      modelVersionId: requiredText(group.modelVersionId, "AI provider modelVersionId"),
      modelFamilyId: normalizedFamilyId(group.modelFamilyId)
    });
  });
  const minIndependentGroups = positiveSafeInteger(value.minIndependentGroups, "AI provider minIndependentGroups");
  if (minIndependentGroups < 2 || minIndependentGroups > groups.length) throw new Error("AI provider minIndependentGroups must be between 2 and group count");
  return Object.freeze({
    schemaVersion: 1,
    policyId,
    policyVersion,
    groups: Object.freeze(groups),
    minIndependentGroups,
    maxProbabilityDelta: boundedUnit(value.maxProbabilityDelta, "AI provider maxProbabilityDelta"),
    minEvidenceReferenceOverlap: boundedUnit(value.minEvidenceReferenceOverlap, "AI provider minEvidenceReferenceOverlap"),
    minAssumptionOverlap: boundedUnit(value.minAssumptionOverlap, "AI provider minAssumptionOverlap"),
    requireUncertaintyAgreement: value.requireUncertaintyAgreement === true,
    inferenceBudget: normalizeAiInferenceBudgetPolicy(value.inferenceBudget)
  });
}

export function aiProviderPoolPolicyIdentity(policy: AiProviderPoolPolicy): string {
  const normalized = normalizeAiProviderPoolPolicy(policy);
  return aiSha256({
    schemaVersion: normalized.schemaVersion,
    policyId: normalized.policyId,
    policyVersion: normalized.policyVersion,
    groups: normalized.groups,
    minIndependentGroups: normalized.minIndependentGroups,
    maxProbabilityDelta: normalized.maxProbabilityDelta,
    minEvidenceReferenceOverlap: normalized.minEvidenceReferenceOverlap,
    minAssumptionOverlap: normalized.minAssumptionOverlap,
    requireUncertaintyAgreement: normalized.requireUncertaintyAgreement,
    inferenceBudget: aiInferenceBudgetIdentity(normalized.inferenceBudget)
  });
}

function maximumIndependentGroupCount(groups: readonly AiProviderGroupPolicy[]): number {
  let maximum = 0;
  const count = groups.length;
  for (let mask = 1; mask < (1 << count); mask += 1) {
    const providers = new Set<string>();
    const families = new Set<string>();
    let size = 0;
    let valid = true;
    for (let index = 0; index < count; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const group = groups[index];
      const provider = normalizedProviderId(group.providerId);
      const family = normalizedFamilyId(group.modelFamilyId);
      if (providers.has(provider) || families.has(family)) { valid = false; break; }
      providers.add(provider);
      families.add(family);
      size += 1;
    }
    if (valid) maximum = Math.max(maximum, size);
  }
  return maximum;
}

function strategyProjection(value: unknown): AiProviderStrategyProjection {
  if (value == null || typeof value !== "object") throw new Error("structured output must be an object");
  const output = value as Partial<StructuredAgentOutput>;
  if (output.schemaVersion !== 1 || output.role !== "STRATEGY_PROPOSER" || !Array.isArray(output.evidenceReferences) || output.payload == null || typeof output.payload !== "object") throw new Error("strategy output schema violation");
  const payload = output.payload as Record<string, unknown>;
  const allowed = new Set(["strategyVersionId", "decision", "rationaleClaims", "assumptions", "uncertainty", "rawProbability", "expectedEffect", "costSensitivity", "capacitySensitivity"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("strategy output contains prohibited fields");
  const decision = String(payload.decision);
  if (!new Set(["candidate", "no_action", "insufficient_evidence"]).has(decision)) throw new Error("strategy decision is invalid");
  const rawProbability = boundedUnit(payload.rawProbability, "strategy rawProbability");
  const uncertainty = requiredText(payload.uncertainty, "strategy uncertainty");
  return Object.freeze({
    decision: decision as AiProviderStrategyProjection["decision"],
    rawProbability,
    uncertainty,
    assumptions: normalizedStrings(payload.assumptions ?? [], "strategy assumptions"),
    rationaleClaims: normalizedStrings(payload.rationaleClaims, "strategy rationaleClaims"),
    evidenceReferences: normalizedStrings(output.evidenceReferences, "strategy evidenceReferences")
  });
}

function jaccard(leftValues: readonly string[], rightValues: readonly string[]): number {
  const left = new Set(leftValues.map(normalizedComparableText));
  const right = new Set(rightValues.map(normalizedComparableText));
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

function pairwiseMinimum(items: readonly AiProviderStrategyProjection[], selector: (left: AiProviderStrategyProjection, right: AiProviderStrategyProjection) => number): number | null {
  if (items.length < 2) return null;
  let minimum = 1;
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) minimum = Math.min(minimum, selector(items[left], items[right]));
  }
  return minimum;
}

function disagreementMetrics(items: readonly AiProviderStrategyProjection[], policy: AiProviderPoolPolicy): AiProviderDisagreementMetrics {
  if (items.length === 0) return Object.freeze({ decisionAgreement: false, uncertaintyAgreement: false, maxProbabilityDelta: null, minimumEvidenceReferenceOverlap: null, minimumAssumptionOverlap: null, disagreementCodes: Object.freeze([]) });
  const decisionAgreement = new Set(items.map((item) => item.decision)).size === 1;
  const uncertaintyAgreement = new Set(items.map((item) => normalizedComparableText(item.uncertainty))).size === 1;
  const probabilities = items.map((item) => item.rawProbability);
  const maxProbabilityDelta = items.length < 2 ? null : Math.max(...probabilities) - Math.min(...probabilities);
  const minimumEvidenceReferenceOverlap = pairwiseMinimum(items, (left, right) => jaccard(left.evidenceReferences, right.evidenceReferences));
  const minimumAssumptionOverlap = pairwiseMinimum(items, (left, right) => jaccard(left.assumptions, right.assumptions));
  const codes: string[] = [];
  if (!decisionAgreement) codes.push("DECISION_MISMATCH");
  if (maxProbabilityDelta != null && maxProbabilityDelta > policy.maxProbabilityDelta) codes.push("PROBABILITY_DELTA_EXCEEDED");
  if (minimumEvidenceReferenceOverlap != null && minimumEvidenceReferenceOverlap < policy.minEvidenceReferenceOverlap) codes.push("EVIDENCE_REFERENCE_OVERLAP_LOW");
  if (minimumAssumptionOverlap != null && minimumAssumptionOverlap < policy.minAssumptionOverlap) codes.push("ASSUMPTION_OVERLAP_LOW");
  if (policy.requireUncertaintyAgreement && !uncertaintyAgreement) codes.push("UNCERTAINTY_MISMATCH");
  return Object.freeze({ decisionAgreement, uncertaintyAgreement, maxProbabilityDelta, minimumEvidenceReferenceOverlap, minimumAssumptionOverlap, disagreementCodes: Object.freeze(codes.sort()) });
}

const emptyMetrics = (code?: string): AiProviderDisagreementMetrics => Object.freeze({
  decisionAgreement: false,
  uncertaintyAgreement: false,
  maxProbabilityDelta: null,
  minimumEvidenceReferenceOverlap: null,
  minimumAssumptionOverlap: null,
  disagreementCodes: Object.freeze(code == null ? [] : [code])
});

export class NVersionStrategyEvaluator {
  private readonly policy: AiProviderPoolPolicy;
  private readonly registry: PromptArtifactRegistry;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly registrations: ReadonlyMap<string, ModelProvider>;
  private readonly cache = new Map<string, { inputHash: string; result: AiProviderComparisonResult }>();

  public constructor(registrations: readonly AiProviderRegistration[], policy: AiProviderPoolPolicy, options: NVersionStrategyEvaluatorOptions = {}) {
    this.policy = normalizeAiProviderPoolPolicy(policy);
    this.registry = options.promptRegistry ?? createDefaultPromptArtifactRegistry();
    this.maxRetries = options.maxRetries ?? 1;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 2) throw new Error("AI retry policy is invalid");
    this.now = options.now ?? Date.now;
    const byGroup = new Map<string, ModelProvider>();
    for (const registration of registrations) {
      const groupId = requiredText(registration.groupId, "AI provider registration groupId");
      if (byGroup.has(groupId)) throw new Error("AI provider registration groupId must be unique");
      byGroup.set(groupId, registration.provider);
    }
    this.registrations = byGroup;
  }

  public async run(input: NVersionStrategyInput): Promise<AiProviderComparisonResult> {
    const startedAt = this.now();
    const resources = new InferenceResourceLedger(this.policy.inferenceBudget, startedAt);
    const policyIdentity = aiProviderPoolPolicyIdentity(this.policy);
    let inputHash: string;
    try {
      const artifact = this.registry.get("nusa.ai.strategy_proposer", "1.0.0");
      inputHash = aiSha256({
        decisionId: input.decisionId,
        evaluatedAt: input.evaluatedAt,
        evidence: [...input.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
        evidenceMaterializations: [...(input.evidenceMaterializations ?? [])].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
        policyVersionIds: [...(input.policyVersionIds ?? [])].sort(),
        certificationIds: [...(input.certificationIds ?? [])].sort(),
        controlPlaneStateId: input.controlPlaneStateId ?? "",
        contextValidForMs: input.contextValidForMs ?? 60_000,
        policyIdentity,
        promptIdentity: artifact == null ? null : { promptArtifactId: artifact.promptArtifactId, version: artifact.version, digest: artifact.digest }
      });
    } catch {
      return this.result(input.comparisonRunId, "UNVERIFIED", policyIdentity, [], emptyMetrics("INPUT_IDENTITY_INVALID"), resources, startedAt);
    }
    const prior = this.cache.get(input.comparisonRunId);
    if (prior != null) {
      if (prior.inputHash === inputHash) return prior.result;
      return this.result(input.comparisonRunId, "UNVERIFIED", policyIdentity, [], emptyMetrics("REPLAY_CONFLICT"), resources, startedAt);
    }

    const configured = this.validateRegistrations();
    if (configured != null) return this.cacheResult(input.comparisonRunId, inputHash, this.result(input.comparisonRunId, "UNVERIFIED", policyIdentity, configured, emptyMetrics("PROVIDER_IDENTITY_MISMATCH"), resources, startedAt));

    if (maximumIndependentGroupCount(this.policy.groups) < this.policy.minIndependentGroups) {
      const groups = this.policy.groups.map((group): AiProviderGroupComparisonEvidence => Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "UNVERIFIED", outputHash: null, failureCode: "INSUFFICIENT_INDEPENDENCE", projection: null }));
      return this.cacheResult(input.comparisonRunId, inputHash, this.result(input.comparisonRunId, "INSUFFICIENT_INDEPENDENCE", policyIdentity, groups, emptyMetrics("INSUFFICIENT_INDEPENDENCE"), resources, startedAt));
    }

    const artifact = this.registry.get("nusa.ai.strategy_proposer", "1.0.0");
    if (artifact == null) return this.cacheResult(input.comparisonRunId, inputHash, this.result(input.comparisonRunId, "UNVERIFIED", policyIdentity, [], emptyMetrics("PROMPT_ARTIFACT_MISSING"), resources, startedAt));
    let bundle;
    try {
      bundle = buildEvidenceBundle({
        contextSnapshotId: `${input.comparisonRunId}:context:strategy-proposer`,
        agentId: "ai-nversion-strategy-proposer",
        evidence: input.evidence,
        evidenceMaterializations: input.evidenceMaterializations ?? [],
        allowedEvidenceClasses: artifact.allowedEvidenceClasses,
        evaluatedAt: input.evaluatedAt,
        validUntil: input.evaluatedAt + (input.contextValidForMs ?? 60_000),
        policyVersionIds: input.policyVersionIds ?? ["AI_ZERO_AUTHORITY_POLICY_V1"],
        certificationIds: input.certificationIds ?? [],
        controlPlaneStateId: input.controlPlaneStateId ?? "AI_CONTROL_PLANE_UNAVAILABLE"
      });
    } catch {
      return this.cacheResult(input.comparisonRunId, inputHash, this.result(input.comparisonRunId, "INCOMPLETE", policyIdentity, [], emptyMetrics("EVIDENCE_CONTEXT_INVALID"), resources, startedAt));
    }
    const modelInput = Object.freeze({
      role: "STRATEGY_PROPOSER" as const,
      contextHash: bundle.context.contextHash,
      evidenceBundleHash: bundle.evidenceBundleHash,
      evidence: bundle.materializedEvidence.map((item) => Object.freeze({
        evidenceId: item.evidence.evidenceId,
        evidenceType: item.evidence.evidenceType,
        observedAt: item.evidence.observedAt,
        validUntil: item.evidence.validUntil,
        quality: item.evidence.quality,
        contentDigest: item.evidence.contentDigest,
        payload: item.payload
      }))
    });
    const sharedInputHash = aiSha256(modelInput);
    const groups: AiProviderGroupComparisonEvidence[] = [];
    let resourceBlocked = false;
    for (const group of this.policy.groups) {
      if (resourceBlocked) {
        groups.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "RESOURCE_BLOCKED", outputHash: null, failureCode: resources.snapshot(this.now()).failureCode ?? "RESOURCE_EXHAUSTED", projection: null }));
        continue;
      }
      const provider = this.registrations.get(group.groupId)!;
      const callId = `${input.comparisonRunId}:call:${group.groupId}:STRATEGY_PROPOSER`;
      if (!resources.reserveCall(callId, this.now())) {
        resourceBlocked = true;
        groups.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "RESOURCE_BLOCKED", outputHash: null, failureCode: resources.snapshot(this.now()).failureCode ?? "RESOURCE_EXHAUSTED", projection: null }));
        continue;
      }
      const request: ModelRequest = Object.freeze({
        requestId: `${input.comparisonRunId}:request:${group.groupId}:STRATEGY_PROPOSER`,
        role: "STRATEGY_PROPOSER",
        providerId: provider.providerId,
        modelVersionId: provider.modelVersionId,
        promptArtifactId: artifact.promptArtifactId,
        promptArtifactVersion: artifact.version,
        promptArtifactDigest: artifact.digest,
        instructions: artifact.instructions,
        contextHash: bundle.context.contextHash,
        inputHash: sharedInputHash,
        input: modelInput,
        maxOutputBytes: 32_768,
        maxTokens: 2_048,
        timeoutMs: 10_000,
        attempt: 0
      });
      const executor = new AgentExecutor(provider, this.maxRetries, resources, this.now);
      const execution = await executor.execute(request, (value) => {
        const projection = strategyProjection(value);
        const output = value as StructuredAgentOutput;
        return Object.freeze({ schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: projection.evidenceReferences, payload: Object.freeze({ ...output.payload }) });
      });
      if (!execution.ok) {
        groups.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: resources.snapshot(this.now()).health === "HEALTHY" ? "FAILED" : "RESOURCE_BLOCKED", outputHash: null, failureCode: execution.failure.code, projection: null }));
        if (resources.snapshot(this.now()).health !== "HEALTHY") resourceBlocked = true;
        continue;
      }
      groups.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "COMPLETED", outputHash: execution.outputHash, failureCode: null, projection: strategyProjection(execution.output) }));
    }

    const completed = groups.filter((group) => group.status === "COMPLETED" && group.projection != null);
    const completedPolicies = this.policy.groups.filter((policyGroup) => completed.some((group) => group.groupId === policyGroup.groupId));
    const metrics = disagreementMetrics(completed.map((group) => group.projection!), this.policy);
    let state: AiProviderComparisonResult["comparisonState"];
    if (completed.length !== this.policy.groups.length) state = "INCOMPLETE";
    else if (maximumIndependentGroupCount(completedPolicies) < this.policy.minIndependentGroups) state = "INSUFFICIENT_INDEPENDENCE";
    else state = metrics.disagreementCodes.length === 0 ? "CONSENSUS" : "DISAGREEMENT";
    return this.cacheResult(input.comparisonRunId, inputHash, this.result(input.comparisonRunId, state, policyIdentity, groups, metrics, resources, startedAt));
  }

  private validateRegistrations(): readonly AiProviderGroupComparisonEvidence[] | null {
    const evidence: AiProviderGroupComparisonEvidence[] = [];
    if (this.registrations.size !== this.policy.groups.length) {
      for (const group of this.policy.groups) evidence.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "UNVERIFIED", outputHash: null, failureCode: "PROVIDER_REGISTRATION_COUNT_MISMATCH", projection: null }));
      return Object.freeze(evidence);
    }
    for (const group of this.policy.groups) {
      const provider = this.registrations.get(group.groupId);
      if (provider == null || normalizedProviderId(provider.providerId) !== normalizedProviderId(group.providerId) || provider.modelVersionId !== group.modelVersionId) {
        evidence.push(Object.freeze({ groupId: group.groupId, providerId: group.providerId, modelVersionId: group.modelVersionId, modelFamilyId: group.modelFamilyId, status: "UNVERIFIED", outputHash: null, failureCode: "PROVIDER_IDENTITY_MISMATCH", projection: null }));
      }
    }
    return evidence.length === 0 ? null : Object.freeze(evidence);
  }

  private result(comparisonRunId: string, state: AiProviderComparisonResult["comparisonState"], policyIdentity: string, groups: readonly AiProviderGroupComparisonEvidence[], metrics: AiProviderDisagreementMetrics, resources: InferenceResourceLedger, startedAt: number): AiProviderComparisonResult {
    const resourceSnapshot = resources.snapshot(Math.max(startedAt, this.now()));
    const independentGroupCount = maximumIndependentGroupCount(this.policy.groups.filter((policyGroup) => groups.some((group) => group.groupId === policyGroup.groupId && group.status === "COMPLETED")));
    const completedGroupCount = groups.filter((group) => group.status === "COMPLETED").length;
    const comparisonIdentity = aiSha256({ comparisonRunId, state, policyIdentity, groups, metrics, resourceHealth: resourceSnapshot.health });
    return Object.freeze({
      schemaVersion: 1,
      comparisonRunId,
      comparisonState: state,
      trustDisposition: state === "CONSENSUS" ? "NO_UPLIFT" : "ABSTAIN",
      independentGroupCount,
      completedGroupCount,
      policyIdentity,
      comparisonIdentity,
      groups: Object.freeze([...groups]),
      metrics,
      inferenceResources: resourceSnapshot,
      liveAuthority: "NONE",
      realOrderAuthority: false,
      realTransferAuthority: false,
      productionMutationAllowed: false
    });
  }

  private cacheResult(comparisonRunId: string, inputHash: string, result: AiProviderComparisonResult): AiProviderComparisonResult {
    this.cache.set(comparisonRunId, { inputHash, result });
    return result;
  }
}
