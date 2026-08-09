import type { AiAgentRole, StructuredAgentOutput } from "./aiInference";
import type { AiInferenceResourceSnapshot } from "./aiInferenceResources";

export type AiNVersionComparisonState =
  | "CONSENSUS"
  | "DISAGREEMENT"
  | "INSUFFICIENT_INDEPENDENCE"
  | "INCOMPLETE"
  | "UNVERIFIED";

export interface AiProviderGroupPolicy {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  /** Opaque non-secret lineage identifier. Credentials/endpoints must never be embedded here. */
  readonly lineageId: string;
}

export interface AiProviderPoolPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly minimumIndependentGroups: number;
  readonly maximumProbabilityDelta: number;
  readonly groups: readonly AiProviderGroupPolicy[];
}

export type AiNVersionGroupStatus = "COMPLETED" | "FAILED" | "NOT_RUN";

export interface AiNVersionGroupEvidence {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly lineageId: string;
  readonly status: AiNVersionGroupStatus;
  readonly role: AiAgentRole;
  readonly promptArtifactDigest: string;
  readonly contextHash: string;
  readonly inputHash: string;
  readonly resourcePolicyId: string;
  readonly resourcePolicyVersion: string;
  readonly output?: StructuredAgentOutput;
  readonly outputHash?: string;
  readonly failureCode?: string;
}

export interface AiNVersionDisagreement {
  readonly field: "decision" | "rawProbability" | "uncertainty" | "assumptions" | "evidenceReferences" | "status";
  readonly groupIds: readonly string[];
  readonly detail: string;
}

export interface AiNVersionComparisonResult {
  readonly schemaVersion: 1;
  readonly state: AiNVersionComparisonState;
  readonly eligibleIndependentGroupIds: readonly string[];
  readonly completedGroupIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly disagreements: readonly AiNVersionDisagreement[];
  readonly resourceSnapshot: AiInferenceResourceSnapshot;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}
