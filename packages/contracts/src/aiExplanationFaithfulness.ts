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

/**
 * Governed, zero-authority explanation-faithfulness/completeness evaluation.
 *
 * NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md scored "Explanation quality / faithfulness" at 2/4:
 * rationale, assumptions, and uncertainty exist in AI explanations (aiSignalExplainer,
 * aiRiskCommentary, researchHypothesisAgent, etc.), but no independent evaluator checks whether
 * an explanation is actually GROUNDED in the evidence it was given, or COMPLETE in the sense of
 * discussing uncertainty and counter-evidence rather than presenting a one-sided narrative. This
 * is the first governed capability for that gap.
 *
 * Deliberately deterministic and lexical, not another model call: an LLM judging another LLM's
 * explanation for faithfulness is exactly the kind of "observational decomposition presented as
 * causal proof" this repo's AI work explicitly refuses to do (see
 * docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md's design principle). A deterministic evaluator is
 * auditable, replay-safe, and cannot itself hallucinate a faithfulness judgment.
 */

export type ExplanationFaithfulnessStrength = "FAITHFUL" | "PARTIALLY_FAITHFUL" | "UNFAITHFUL";

export type ExplanationFaithfulnessReasonCode =
  | "EMPTY_EXPLANATION"
  | "UNGROUNDED_NUMERIC_CLAIM"
  | "MISSING_UNCERTAINTY_DISCUSSION"
  | "MISSING_COUNTEREVIDENCE_DISCUSSION"
  | "DIRECTION_INCONSISTENT_WITH_DECISION"
  | "CONFIDENCE_LANGUAGE_OVERCLAIMS";

export type ExplanationDecisionAction = "BUY" | "SELL" | "HOLD" | "REDUCE" | "EXIT" | "WAIT";

export interface ExplanationEvidenceSnapshot {
  /** Every numeric value the explainer was legitimately given (prices, indicators, PnL, sizes,
   * bps figures, etc.), in the same units/scale the explanation text would state them in. A
   * number appearing in the explanation that matches none of these is treated as unsupported. */
  readonly numericFacts: readonly number[];
}

export interface ExplanationDecisionContext {
  readonly action: ExplanationDecisionAction;
  /** 0..1. Low confidence paired with certainty language in the explanation is a faithfulness
   * violation: the explanation is claiming more than the decision itself asserts. */
  readonly confidence: number;
}

export interface ExplanationFaithfulnessRequest {
  readonly schemaVersion: 1;
  readonly explanationId: string;
  readonly explanationText: string;
  readonly evidence: ExplanationEvidenceSnapshot;
  readonly decision: ExplanationDecisionContext;
  readonly evaluatedAt: number;
}

export interface ExplanationFaithfulnessResult {
  readonly explanationId: string;
  readonly strength: ExplanationFaithfulnessStrength;
  readonly reasonCodes: readonly ExplanationFaithfulnessReasonCode[];
  /** Numbers found in the explanation text that matched no evidence fact -- named evidence for
   * UNGROUNDED_NUMERIC_CLAIM rather than a bare boolean. */
  readonly ungroundedNumbers: readonly number[];
  readonly evaluatedAt: number;
  readonly requestSha256: string;
  readonly resultSha256: string;
}
