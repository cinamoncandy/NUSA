import { aiSha256 } from "./aiInference";

export type AiExplanationSupportStatus = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
export type AiExplanationProvenance = "OBSERVED" | "HYPOTHETICAL";
export type AiExplanationAttributionStrength = "IDENTIFIED" | "PARTIALLY_IDENTIFIED" | "UNRESOLVED" | "UNVERIFIED";

export interface AiExplanationPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly maxClaims: number;
  readonly maxEvidencePerClaim: number;
  readonly materialCounterEvidenceIds: readonly string[];
  readonly minimumConfidenceForAssertiveLanguage: number;
  readonly resourcePolicyIdentity: string;
}

export interface AiExplanationEvidence {
  readonly evidenceId: string;
  readonly digest: string;
  readonly provenance: AiExplanationProvenance;
  readonly supportsClaimIds: readonly string[];
  readonly contradictsClaimIds: readonly string[];
  readonly material: boolean;
}

export interface AiExplanationClaim {
  readonly claimId: string;
  readonly text: string;
  readonly citedEvidenceIds: readonly string[];
  readonly provenance: AiExplanationProvenance;
  readonly assertive: boolean;
  readonly attributionStrength?: AiExplanationAttributionStrength;
}

export interface AiExplanationLineage {
  readonly decisionId: string;
  readonly decisionDigest: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactDigest: string;
  readonly schemaVersion: string;
  readonly calibrationIdentity: string;
  readonly scenarioIdentity: string | null;
  readonly attributionIdentity: string | null;
  readonly canonicalInputHash: string;
  readonly replayIdentity: string;
  readonly holdoutPartitionIdentity: string;
}

export interface AiExplanationEnvelope {
  readonly schemaVersion: 1;
  readonly explanationId: string;
  readonly policy: AiExplanationPolicy;
  readonly lineage: AiExplanationLineage;
  readonly claims: readonly AiExplanationClaim[];
  readonly evidence: readonly AiExplanationEvidence[];
  readonly confidence: number;
  readonly abstained: boolean;
  readonly providerDisagreement: boolean;
  readonly attributionStrength: AiExplanationAttributionStrength;
  readonly observedAt: number;
  readonly contentDigest: string;
}

export interface AiExplanationVerificationResult {
  readonly schemaVersion: 1;
  readonly explanationId: string;
  readonly verdict: "PASS" | "ABSTAIN";
  readonly claimStatuses: Readonly<Record<string, AiExplanationSupportStatus>>;
  readonly reasonCodes: readonly string[];
  readonly evidenceDigest: string;
  readonly replayIdentity: string;
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}

export function explanationContentDigest(input: Omit<AiExplanationEnvelope, "contentDigest">): string {
  return aiSha256(input);
}

