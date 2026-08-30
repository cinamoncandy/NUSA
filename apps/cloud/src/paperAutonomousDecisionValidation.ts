import {
  validatePaperCandidateExecutionBinding,
  type CioAction,
  type CioDecision,
  type RiskLevel,
} from "./cioDecisionEngine";

const ACTIONS = new Set<CioAction>(["BUY", "SELL", "HOLD", "REDUCE", "EXIT", "WAIT"]);
const RISKS = new Set<RiskLevel>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const DEFAULT_MAX_DECISION_AGE_MS = 30_000;

export interface PaperAutonomousDecisionValidationContext {
  readonly now: number;
  readonly maxDecisionAgeMs?: number;
}

function assertUnit(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`PAPER_DECISION_${field.toUpperCase()}_INVALID`);
}

/**
 * Runtime validation boundary for autonomous PAPER decisions.
 * TypeScript types are not a trust boundary, so externally supplied decision records are
 * revalidated immediately before they can reach the simulated execution loop.
 */
export function validatePaperAutonomousDecisions(
  decisions: readonly CioDecision[],
  context: PaperAutonomousDecisionValidationContext,
): readonly CioDecision[] {
  if (!Array.isArray(decisions)) throw new Error("PAPER_DECISIONS_INVALID");
  if (!Number.isSafeInteger(context.now) || context.now < 0) throw new Error("PAPER_DECISION_CLOCK_INVALID");
  const maxDecisionAgeMs = context.maxDecisionAgeMs ?? DEFAULT_MAX_DECISION_AGE_MS;
  if (!Number.isSafeInteger(maxDecisionAgeMs) || maxDecisionAgeMs < 0) throw new Error("PAPER_DECISION_MAX_AGE_INVALID");

  const seenSymbols = new Set<string>();
  const validated = decisions.map((decision) => {
    if (decision == null || typeof decision !== "object") throw new Error("PAPER_DECISION_INVALID");
    const symbol = decision.symbol?.trim().toUpperCase();
    if (!symbol || decision.symbol !== symbol) throw new Error("PAPER_DECISION_SYMBOL_INVALID");
    if (seenSymbols.has(symbol)) throw new Error("PAPER_DECISION_DUPLICATE_SYMBOL");
    seenSymbols.add(symbol);
    if (!ACTIONS.has(decision.action)) throw new Error("PAPER_DECISION_ACTION_INVALID");
    if (!RISKS.has(decision.risk)) throw new Error("PAPER_DECISION_RISK_INVALID");
    assertUnit(decision.confidence, "confidence");
    assertUnit(decision.allocation, "allocation");
    if (!Number.isInteger(decision.leverage) || decision.leverage < 1 || decision.leverage > 20) throw new Error("PAPER_DECISION_LEVERAGE_INVALID");
    if (!Number.isFinite(decision.score) || decision.score < -1 || decision.score > 1) throw new Error("PAPER_DECISION_SCORE_INVALID");
    if (!Array.isArray(decision.reasons) || decision.reasons.length === 0 || decision.reasons.some((reason: unknown) => typeof reason !== "string" || !reason.trim())) throw new Error("PAPER_DECISION_REASONS_INVALID");
    const reasons = decision.reasons as readonly string[];
    if (!Number.isSafeInteger(decision.decidedAt) || decision.decidedAt < 0 || decision.decidedAt > context.now) throw new Error("PAPER_DECISION_CLOCK_INVALID");
    if (context.now - decision.decidedAt > maxDecisionAgeMs) throw new Error("PAPER_DECISION_STALE");

    const paperCandidateBinding = decision.paperCandidateBinding == null
      ? undefined
      : validatePaperCandidateExecutionBinding(decision.paperCandidateBinding, decision.decidedAt);

    return Object.freeze({
      ...decision,
      reasons: Object.freeze(reasons.map((reason: string) => reason.trim())),
      ...(paperCandidateBinding == null ? {} : { paperCandidateBinding }),
    });
  });

  return Object.freeze(validated);
}
