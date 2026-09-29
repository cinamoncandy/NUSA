/**
 * Canonical minimum confidence required before an automatic PAPER strategy may become actionable.
 *
 * This value is shared by candidate evaluation and the production execution boundary so a strategy
 * cannot emit BUY/SELL at a confidence that the canonical boundary will immediately reject.
 * It grants no LIVE or production-mutation authority.
 */
export const AUTOMATIC_PAPER_MIN_CONFIDENCE = 0.55 as const;

export function automaticPaperConfidenceAllowsAction(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= AUTOMATIC_PAPER_MIN_CONFIDENCE && confidence <= 1;
}
