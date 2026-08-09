import { aiSha256, canonicalAiJson, type ModelProvider, type ModelRequest, type StructuredAgentOutput } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceBudgetPolicy } from "../../../../packages/contracts/src/aiInferenceResources";
import type {
  AiNVersionComparisonResult,
  AiNVersionDisagreement,
  AiNVersionGroupEvidence,
  AiProviderGroupPolicy,
  AiProviderPoolPolicy
} from "../../../../packages/contracts/src/aiNVersion";
import { AgentExecutor, type StructuredOutputValidator } from "./agentExecutor";
import { InferenceResourceLedger, normalizeAiInferenceBudgetPolicy } from "./inferenceResourceLedger";

export type AiNVersionRequestTemplate = Omit<ModelRequest, "requestId" | "providerId" | "modelVersionId" | "attempt">;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const normalizeGroup = (group: AiProviderGroupPolicy): AiProviderGroupPolicy => Object.freeze({
  groupId: requiredText(group.groupId, "provider groupId"),
  providerId: requiredText(group.providerId, "provider providerId"),
  modelVersionId: requiredText(group.modelVersionId, "provider modelVersionId"),
  lineageId: requiredText(group.lineageId, "provider lineageId")
});

export function normalizeAiProviderPoolPolicy(policy: AiProviderPoolPolicy): AiProviderPoolPolicy {
  if (policy.schemaVersion !== 1) throw new Error("AI provider pool schemaVersion is unsupported");
  if (!Number.isSafeInteger(policy.minimumIndependentGroups) || policy.minimumIndependentGroups < 2) {
    throw new Error("minimumIndependentGroups must be at least 2");
  }
  if (typeof policy.maximumProbabilityDelta !== "number" || !Number.isFinite(policy.maximumProbabilityDelta) || policy.maximumProbabilityDelta < 0 || policy.maximumProbabilityDelta > 1) {
    throw new Error("maximumProbabilityDelta must be finite and within [0,1]");
  }
  if (!Array.isArray(policy.groups) || policy.groups.length === 0) throw new Error("provider groups are required");
  const groups = policy.groups.map(normalizeGroup);
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (groupIds.has(group.groupId)) throw new Error(`duplicate provider groupId:${group.groupId}`);
    groupIds.add(group.groupId);
  }
  return Object.freeze({
    schemaVersion: 1,
    policyId: requiredText(policy.policyId, "provider pool policyId"),
    policyVersion: requiredText(policy.policyVersion, "provider pool policyVersion"),
    minimumIndependentGroups: policy.minimumIndependentGroups,
    maximumProbabilityDelta: policy.maximumProbabilityDelta,
    groups: Object.freeze(groups)
  });
}

export function aiProviderPoolIdentity(policy: AiProviderPoolPolicy): Readonly<Record<string, unknown>> {
  const normalized = normalizeAiProviderPoolPolicy(policy);
  return Object.freeze({
    schemaVersion: normalized.schemaVersion,
    policyId: normalized.policyId,
    policyVersion: normalized.policyVersion,
    minimumIndependentGroups: normalized.minimumIndependentGroups,
    maximumProbabilityDelta: normalized.maximumProbabilityDelta,
    groups: normalized.groups.map((group) => Object.freeze({
      groupId: group.groupId,
      providerId: group.providerId,
      modelVersionId: group.modelVersionId,
      lineageId: group.lineageId
    }))
  });
}

const sortedStrings = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return Object.freeze([]);
  return Object.freeze([...new Set(value as string[])].sort());
};

const sameCanonical = (values: readonly unknown[]): boolean => values.length < 2 || values.every((value) => canonicalAiJson(value) === canonicalAiJson(values[0]));

function compareCompletedGroups(groups: readonly AiNVersionGroupEvidence[], maximumProbabilityDelta: number): readonly AiNVersionDisagreement[] {
  const disagreements: AiNVersionDisagreement[] = [];
  const payloads = groups.map((group) => group.output?.payload ?? Object.freeze({}));
  const decisions = payloads.map((payload) => payload.decision);
  if (!sameCanonical(decisions)) disagreements.push(Object.freeze({ field: "decision", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: "decision fields differ across independent groups" }));

  const probabilities = payloads.map((payload) => payload.rawProbability).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (probabilities.length !== 0 && probabilities.length !== groups.length) {
    disagreements.push(Object.freeze({ field: "rawProbability", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: "rawProbability is missing or invalid for at least one independent group" }));
  } else if (probabilities.length > 1 && Math.max(...probabilities) - Math.min(...probabilities) > maximumProbabilityDelta) {
    disagreements.push(Object.freeze({ field: "rawProbability", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: `rawProbability delta exceeds ${maximumProbabilityDelta}` }));
  }

  const uncertainties = payloads.map((payload) => payload.uncertainty);
  if (!sameCanonical(uncertainties)) disagreements.push(Object.freeze({ field: "uncertainty", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: "uncertainty fields differ across independent groups" }));

  const assumptions = payloads.map((payload) => sortedStrings(payload.assumptions));
  if (!sameCanonical(assumptions)) disagreements.push(Object.freeze({ field: "assumptions", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: "assumption sets differ across independent groups" }));

  const evidenceReferences = groups.map((group) => sortedStrings(group.output?.evidenceReferences));
  if (!sameCanonical(evidenceReferences)) disagreements.push(Object.freeze({ field: "evidenceReferences", groupIds: Object.freeze(groups.map((group) => group.groupId)), detail: "evidence reference sets differ across independent groups" }));
  return Object.freeze(disagreements);
}

function independentGroups(policy: AiProviderPoolPolicy, completed: readonly AiNVersionGroupEvidence[]): readonly AiNVersionGroupEvidence[] {
  const selected: AiNVersionGroupEvidence[] = [];
  const providers = new Set<string>();
  const lineages = new Set<string>();
  const policyById = new Map(policy.groups.map((group) => [group.groupId, group] as const));
  for (const evidence of [...completed].sort((left, right) => left.groupId.localeCompare(right.groupId))) {
    const declared = policyById.get(evidence.groupId);
    if (declared == null) continue;
    if (declared.providerId !== evidence.providerId || declared.modelVersionId !== evidence.modelVersionId || declared.lineageId !== evidence.lineageId) continue;
    if (providers.has(evidence.providerId) || lineages.has(evidence.lineageId)) continue;
    providers.add(evidence.providerId);
    lineages.add(evidence.lineageId);
    selected.push(evidence);
  }
  return Object.freeze(selected);
}

export function compareAiNVersionEvidence(
  policyValue: AiProviderPoolPolicy,
  groups: readonly AiNVersionGroupEvidence[],
  resourceSnapshot: ReturnType<InferenceResourceLedger["snapshot"]>
): AiNVersionComparisonResult {
  const policy = normalizeAiProviderPoolPolicy(policyValue);
  const reasonCodes: string[] = [];
  const completed = groups.filter((group) => group.status === "COMPLETED" && group.output != null && group.outputHash != null);
  const base = completed[0];
  const comparable = base == null || completed.every((group) =>
    group.role === base.role &&
    group.promptArtifactDigest === base.promptArtifactDigest &&
    group.contextHash === base.contextHash &&
    group.inputHash === base.inputHash &&
    group.resourcePolicyId === base.resourcePolicyId &&
    group.resourcePolicyVersion === base.resourcePolicyVersion
  );

  let state: AiNVersionComparisonResult["state"];
  let disagreements: readonly AiNVersionDisagreement[] = Object.freeze([]);
  const eligible = independentGroups(policy, completed);

  if (resourceSnapshot.health === "UNVERIFIED" || !comparable) {
    state = "UNVERIFIED";
    reasonCodes.push(resourceSnapshot.health === "UNVERIFIED" ? "RESOURCE_ACCOUNTING_UNVERIFIED" : "COMPARISON_IDENTITY_MISMATCH");
  } else if (groups.some((group) => group.status !== "COMPLETED")) {
    state = "INCOMPLETE";
    reasonCodes.push("PARTIAL_PROVIDER_FAILURE");
  } else if (eligible.length < policy.minimumIndependentGroups) {
    state = "INSUFFICIENT_INDEPENDENCE";
    reasonCodes.push("CROSS_PROVIDER_INDEPENDENCE_INSUFFICIENT");
  } else {
    disagreements = compareCompletedGroups(eligible, policy.maximumProbabilityDelta);
    state = disagreements.length === 0 ? "CONSENSUS" : "DISAGREEMENT";
    reasonCodes.push(state === "CONSENSUS" ? "INDEPENDENT_CONSENSUS" : "INDEPENDENT_DISAGREEMENT");
  }

  if (completed.length > eligible.length) reasonCodes.push("CORRELATED_OR_DUPLICATE_GROUPS_EXCLUDED");
  return Object.freeze({
    schemaVersion: 1,
    state,
    eligibleIndependentGroupIds: Object.freeze(eligible.map((group) => group.groupId)),
    completedGroupIds: Object.freeze(completed.map((group) => group.groupId).sort()),
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    disagreements,
    resourceSnapshot,
    liveAuthority: "NONE",
    realOrderAuthority: false,
    realTransferAuthority: false,
    productionMutationAllowed: false
  });
}

export class NVersionInferenceRunner {
  private readonly policy: AiProviderPoolPolicy;
  private readonly resourcePolicy: AiInferenceBudgetPolicy;
  private readonly maxRetries: number;

  public constructor(
    policy: AiProviderPoolPolicy,
    private readonly providers: ReadonlyMap<string, ModelProvider>,
    resourcePolicy: AiInferenceBudgetPolicy,
    maxRetries = 0,
    private readonly now: () => number = Date.now
  ) {
    this.policy = normalizeAiProviderPoolPolicy(policy);
    this.resourcePolicy = normalizeAiInferenceBudgetPolicy(resourcePolicy);
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error("AI retry policy is invalid");
    this.maxRetries = maxRetries;
    for (const group of this.policy.groups) {
      const provider = this.providers.get(group.groupId);
      if (provider == null) continue;
      if (provider.providerId !== group.providerId || provider.modelVersionId !== group.modelVersionId) throw new Error(`provider identity mismatch:${group.groupId}`);
    }
  }

  public async execute(
    comparisonIdValue: string,
    requestTemplate: AiNVersionRequestTemplate,
    validate: StructuredOutputValidator
  ): Promise<AiNVersionComparisonResult> {
    const comparisonId = requiredText(comparisonIdValue, "comparisonId");
    const startedAt = this.now();
    const resources = new InferenceResourceLedger(this.resourcePolicy, startedAt);
    const groupEvidence: AiNVersionGroupEvidence[] = [];

    for (const group of this.policy.groups) {
      const provider = this.providers.get(group.groupId);
      if (provider == null) {
        groupEvidence.push(this.failedEvidence(group, requestTemplate, "NOT_RUN", "PROVIDER_NOT_CONFIGURED"));
        continue;
      }
      if (!resources.reserveCall(`${comparisonId}:call:${group.groupId}:${requestTemplate.role}`, this.now())) {
        groupEvidence.push(this.failedEvidence(group, requestTemplate, "NOT_RUN", resources.snapshot(this.now()).failureCode ?? "RESOURCE_EXHAUSTED"));
        continue;
      }
      const request: ModelRequest = Object.freeze({
        ...requestTemplate,
        requestId: `${comparisonId}:request:${group.groupId}:${requestTemplate.role}`,
        providerId: group.providerId,
        modelVersionId: group.modelVersionId,
        attempt: 0
      });
      const result = await new AgentExecutor(provider, this.maxRetries, resources, this.now).execute(request, validate);
      if (!result.ok) {
        groupEvidence.push(this.failedEvidence(group, requestTemplate, "FAILED", result.failure.code));
        continue;
      }
      groupEvidence.push(Object.freeze({
        groupId: group.groupId,
        providerId: group.providerId,
        modelVersionId: group.modelVersionId,
        lineageId: group.lineageId,
        status: "COMPLETED",
        role: requestTemplate.role,
        promptArtifactDigest: requestTemplate.promptArtifactDigest,
        contextHash: requestTemplate.contextHash,
        inputHash: requestTemplate.inputHash,
        resourcePolicyId: this.resourcePolicy.policyId,
        resourcePolicyVersion: this.resourcePolicy.policyVersion,
        output: result.output,
        outputHash: result.outputHash
      }));
    }
    return compareAiNVersionEvidence(this.policy, Object.freeze(groupEvidence), resources.snapshot(this.now()));
  }

  public identity(): string {
    return aiSha256({ providerPool: aiProviderPoolIdentity(this.policy), resourcePolicy: this.resourcePolicy });
  }

  private failedEvidence(
    group: AiProviderGroupPolicy,
    requestTemplate: AiNVersionRequestTemplate,
    status: "FAILED" | "NOT_RUN",
    failureCode: string
  ): AiNVersionGroupEvidence {
    return Object.freeze({
      groupId: group.groupId,
      providerId: group.providerId,
      modelVersionId: group.modelVersionId,
      lineageId: group.lineageId,
      status,
      role: requestTemplate.role,
      promptArtifactDigest: requestTemplate.promptArtifactDigest,
      contextHash: requestTemplate.contextHash,
      inputHash: requestTemplate.inputHash,
      resourcePolicyId: this.resourcePolicy.policyId,
      resourcePolicyVersion: this.resourcePolicy.policyVersion,
      failureCode
    });
  }
}
