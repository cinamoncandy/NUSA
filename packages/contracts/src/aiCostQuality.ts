/**
 * Governed, zero-authority monetary cost estimation for AI inference usage.
 *
 * NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md scored "Cost-quality optimization" at 2/4: calls,
 * tokens, and latency are bounded and auditable (WO-AI-006's AiInferenceResourceSnapshot), but
 * nothing translates verified token usage into an actual monetary cost figure, so there is no
 * way to see -- let alone bound or compare -- what a run actually cost in real terms.
 *
 * A rate card here is deliberately an explicit, VERSIONED, operator-supplied input, never a
 * live-fetched or model-guessed price: provider pricing changes over time and this module must
 * never silently go stale while pretending to be current. `AiCostRateCard.rateCardVersion` is
 * exactly the thing a reader checks before trusting a cost figure -- see
 * `evaluateAiInferenceCost`'s UNVERIFIED status when either usage accounting or a rate-card
 * entry is missing.
 */

export type AiCostStatus = "ESTIMATED" | "UNVERIFIED";

export interface AiCostRate {
  /** Price per 1,000,000 input tokens, in the rate card's currency. */
  readonly inputPricePerMillionTokens: number;
  /** Price per 1,000,000 output tokens, in the rate card's currency. */
  readonly outputPricePerMillionTokens: number;
}

export interface AiCostRateCard {
  readonly schemaVersion: 1;
  readonly rateCardId: string;
  readonly rateCardVersion: string;
  readonly currency: string;
  /** Keyed by `${providerId}:${modelVersionId}`. A model/provider pair absent from this map has
   * no known price -- the cost estimate for it is UNVERIFIED, never assumed to be zero. */
  readonly rates: Readonly<Record<string, AiCostRate>>;
}

export interface AiCostEstimate {
  readonly status: AiCostStatus;
  /** Null when status is UNVERIFIED -- an absent or fabricated cost figure must never be
   * confused with a verified zero-cost run. */
  readonly estimatedCost: number | null;
  readonly currency: string | null;
  readonly rateCardId: string | null;
  readonly rateCardVersion: string | null;
  readonly providerId: string | null;
  readonly modelVersionId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

// Extends the shared read-only AI projection via the same declaration-merging pattern
// aiInferenceResources.ts, aiProviderDiversity.ts, and aiExplanationFaithfulness.ts already use.
// Every field is optional, so no existing AiReadOnlyProjection object literal needs to change.
declare module "./aiInference" {
  interface AiReadOnlyProjection {
    readonly costStatus?: AiCostStatus;
    readonly estimatedCost?: number | null;
    readonly costCurrency?: string | null;
    readonly costRateCardId?: string | null;
    readonly costRateCardVersion?: string | null;
  }
}
