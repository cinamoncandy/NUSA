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

// Extends the shared read-only AI projection every consumer already reads, via the same
// declaration-merging pattern aiInferenceResources.ts and aiProviderDiversity.ts use to add
// their own fields to AiReadOnlyProjection. Every field here is optional, so no existing
// AiReadOnlyProjection object literal anywhere in the codebase needs to change for this to
// compile -- see projection.ts's applyExplanationFaithfulness() for where these get set.
declare module "./aiInference" {
  interface AiReadOnlyProjection {
    readonly explanationFaithfulnessStrength?: ExplanationFaithfulnessStrength;
    readonly explanationFaithfulnessReasonCodes?: readonly ExplanationFaithfulnessReasonCode[];
    readonly explanationFaithfulnessUngroundedNumbers?: readonly number[];
  }
}
