/**
 * Bounded reason code for a WAIT PAPER decision, derived only from fields the canonical decision already carries.
 * Display / funnel evidence only: it never changes the decision, and the code set is fixed (no free text,
 * prices, markets or identifiers), so it can be counted per reason on /health.
 */
export const PAPER_WAIT_REASONS = Object.freeze([
  "RISK_REGIME",
  "TRADING_DISABLED",
  "INSUFFICIENT_HISTORY",
  "LOW_CONFIDENCE",
  "NO_SIGNAL",
  "ALREADY_IN_POSITION",
  "NO_POSITION_TO_SELL",
] as const);
export type PaperWaitReason = (typeof PAPER_WAIT_REASONS)[number];

export interface PaperWaitDecisionFacts {
  readonly action: string;
  readonly risk?: string;
  readonly allocation?: number;
  readonly paperCandidateStrategyDecision?: { readonly action?: string; readonly reason?: string } | null;
}

export function classifyPaperWait(decision: PaperWaitDecisionFacts): PaperWaitReason | null {
  if (decision.action !== "WAIT") return null;
  if (decision.risk === "CRITICAL" || decision.risk === "HIGH") return "RISK_REGIME";
  const holding = typeof decision.allocation === "number" && decision.allocation > 0;
  const strategy = decision.paperCandidateStrategyDecision;
  if (strategy == null || typeof strategy.action !== "string") return "NO_SIGNAL";
  switch (strategy.action) {
    case "WAIT":
      return typeof strategy.reason === "string" && strategy.reason.startsWith("INSUFFICIENT_") ? "INSUFFICIENT_HISTORY" : "LOW_CONFIDENCE";
    case "BUY":
      // A flat BUY that still became WAIT outside a high-risk regime can only be the trading-enabled gate.
      return holding ? "ALREADY_IN_POSITION" : "TRADING_DISABLED";
    case "SELL":
      return holding ? "TRADING_DISABLED" : "NO_POSITION_TO_SELL";
    case "HOLD":
      return holding ? "TRADING_DISABLED" : "NO_SIGNAL";
    default:
      return "NO_SIGNAL";
  }
}
