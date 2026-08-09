import type { AiInferenceBudgetPolicy, AiInferenceResourceSnapshot } from "./aiInferenceResources";

export type AiProviderComparisonState = "CONSENSUS" | "DISAGREEMENT" | "INSUFFICIENT_INDEPENDENCE" | "INCOMPLETE" | "UNVERIFIED";
export type AiProviderTrustDisposition = "NO_UPLIFT" | "REDUCE" | "ABSTAIN";
export type AiProviderGroupRunStatus = "COMPLETED" | "FAILED" | "RESOURCE_BLOCKED" | "UNVERIFIED";

export interface AiProviderGroupPolicy {
  readonly groupId: string;
  /** Canonical adapter identity. Aliases must never replace this value. */
  readonly providerId: string;
  readonly modelVersionId: string;
  /** Stable declared model-family lineage, e.g. claude-sonnet or gpt. */
  readonly modelFamilyId: string;
}

export interface AiProviderPoolPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly groups: readonly AiProviderGroupPolicy[];
  readonly minIndependentGroups: number;
  readonly maxProbabilityDelta: number;
  readonly minEvidenceReferenceOverlap: number;
  readonly minAssumptionOverlap: number;
  readonly requireUncertaintyAgreement: boolean;
  readonly inferenceBudget: AiInferenceBudgetPolicy;
}

export interface AiProviderStrategyProjection {
  readonly decision: "candidate" | "no_action" | "insufficient_evidence";
  readonly rawProbability: number;
  readonly uncertainty: string;
  readonly assumptions: readonly string[];
  readonly rationaleClaims: readonly string[];
  readonly evidenceReferences: readonly string[];
}

export interface AiProviderGroupComparisonEvidence {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly modelFamilyId: string;
  readonly status: AiProviderGroupRunStatus;
  readonly outputHash: string | null;
  readonly failureCode: string | null;
  readonly projection: AiProviderStrategyProjection | null;
}

export interface AiProviderDisagreementMetrics {
  readonly decisionAgreement: boolean;
  readonly uncertaintyAgreement: boolean;
  readonly maxProbabilityDelta: number | null;
  readonly minimumEvidenceReferenceOverlap: number | null;
  readonly minimumAssumptionOverlap: number | null;
  readonly disagreementCodes: readonly string[];
}

export interface AiProviderComparisonResult {
  readonly schemaVersion: 1;
  readonly comparisonRunId: string;
  readonly comparisonState: AiProviderComparisonState;
  readonly trustDisposition: AiProviderTrustDisposition;
  readonly independentGroupCount: number;
  readonly completedGroupCount: number;
  readonly policyIdentity: string;
  readonly comparisonIdentity: string;
  readonly groups: readonly AiProviderGroupComparisonEvidence[];
  readonly metrics: AiProviderDisagreementMetrics;
  readonly inferenceResources: AiInferenceResourceSnapshot;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}

declare module "./aiInference" {
  interface AiReadOnlyProjection {
    readonly providerComparisonState?: AiProviderComparisonState;
    readonly providerTrustDisposition?: AiProviderTrustDisposition;
    readonly providerIndependentGroupCount?: number;
    readonly providerCompletedGroupCount?: number;
    readonly providerDisagreementCodes?: readonly string[];
    readonly providerComparisonIdentity?: string | null;
    readonly providerComparisonResourceHealth?: AiInferenceResourceSnapshot["health"];
    readonly providerComparisonModelCalls?: number;
    readonly providerComparisonAttempts?: number;
  }
}
