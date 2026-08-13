import type { AiInferenceResourceSnapshot } from "../../../../packages/contracts/src/aiInferenceResources";
import type { AiCostEstimate, AiCostRateCard } from "../../../../packages/contracts/src/aiCostQuality";

/**
 * Example/default rate card -- NOT a live price feed. Whoever operates this system is
 * responsible for keeping rateCardVersion current with real provider pricing; a stale entry is
 * still explicit and auditable (the version string says so), unlike a silently-wrong guess.
 * Prices are illustrative order-of-magnitude placeholders, not a claim about actual current
 * provider pricing -- do not treat this constant as authoritative without updating it first.
 */
export const DEFAULT_AI_COST_RATE_CARD: AiCostRateCard = Object.freeze({
  schemaVersion: 1,
  rateCardId: "NUSA_AI_COST_RATE_CARD",
  rateCardVersion: "0.0.0-unset",
  currency: "USD",
  rates: Object.freeze({})
});

const emptyEstimate = (rateCard: AiCostRateCard | undefined): AiCostEstimate => Object.freeze({
  status: "UNVERIFIED",
  estimatedCost: null,
  currency: rateCard?.currency ?? null,
  rateCardId: rateCard?.rateCardId ?? null,
  rateCardVersion: rateCard?.rateCardVersion ?? null,
  providerId: null,
  modelVersionId: null,
  inputTokens: null,
  outputTokens: null
});

/**
 * Translates verified token usage into a monetary cost estimate against an explicit, versioned
 * rate card. Fails closed to UNVERIFIED (never a fabricated zero or guessed figure) when:
 *   - usage accounting isn't VERIFIED (actual token counts aren't trustworthy),
 *   - the snapshot's actual input/output token counts are null,
 *   - the (providerId, modelVersionId) pair has no entry in the rate card.
 */
export function evaluateAiInferenceCost(
  snapshot: AiInferenceResourceSnapshot | undefined,
  providerId: string | undefined,
  modelVersionId: string | undefined,
  rateCard: AiCostRateCard = DEFAULT_AI_COST_RATE_CARD
): AiCostEstimate {
  if (snapshot == null || providerId == null || modelVersionId == null) return emptyEstimate(rateCard);
  if (snapshot.usageAccountingStatus !== "VERIFIED") return emptyEstimate(rateCard);
  if (snapshot.actualInputTokens == null || snapshot.actualOutputTokens == null) return emptyEstimate(rateCard);
  if (!Number.isFinite(snapshot.actualInputTokens) || snapshot.actualInputTokens < 0) return emptyEstimate(rateCard);
  if (!Number.isFinite(snapshot.actualOutputTokens) || snapshot.actualOutputTokens < 0) return emptyEstimate(rateCard);

  const rate = rateCard.rates[`${providerId}:${modelVersionId}`];
  if (rate == null) return emptyEstimate(rateCard);
  if (!Number.isFinite(rate.inputPricePerMillionTokens) || rate.inputPricePerMillionTokens < 0) return emptyEstimate(rateCard);
  if (!Number.isFinite(rate.outputPricePerMillionTokens) || rate.outputPricePerMillionTokens < 0) return emptyEstimate(rateCard);

  const inputCost = (snapshot.actualInputTokens / 1_000_000) * rate.inputPricePerMillionTokens;
  const outputCost = (snapshot.actualOutputTokens / 1_000_000) * rate.outputPricePerMillionTokens;
  const estimatedCost = inputCost + outputCost;

  return Object.freeze({
    status: "ESTIMATED",
    estimatedCost,
    currency: rateCard.currency,
    rateCardId: rateCard.rateCardId,
    rateCardVersion: rateCard.rateCardVersion,
    providerId,
    modelVersionId,
    inputTokens: snapshot.actualInputTokens,
    outputTokens: snapshot.actualOutputTokens
  });
}
