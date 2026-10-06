import type { CioDecision } from "./cioDecisionEngine";
import type { PersonalPaperDecisionDetail } from "../../../packages/contracts/src/personalPaperOperations";

const MAX_REASON_LENGTH = 160;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Display-only explanation of one canonical decision: the action, the score and confidence it was made on, the
 * risk level, whether a position is held, the candidate strategy's own action and its first reason (which carries
 * the indicator values). The reason is reduced to a bare code charset so no free text reaches the app, and nothing
 * here can influence a decision, an order or the risk gate.
 */
export function describeCanonicalDecision(decision: Pick<CioDecision, "action" | "score" | "confidence" | "risk" | "allocation" | "reasons" | "paperCandidateStrategyDecision">, observedAt: number): PersonalPaperDecisionDetail {
  const first = decision.reasons[0];
  const reason = typeof first === "string"
    ? first.replace(/[^A-Za-z0-9_.:/=+-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_REASON_LENGTH)
    : "";
  const strategyAction = decision.paperCandidateStrategyDecision?.action;
  return Object.freeze({
    action: decision.action,
    score: Number.isFinite(decision.score) ? round4(decision.score) : 0,
    confidence: Number.isFinite(decision.confidence) ? round4(decision.confidence) : 0,
    risk: decision.risk,
    hasPosition: decision.allocation > 0,
    ...(strategyAction === undefined ? {} : { strategyAction }),
    ...(reason === "" ? {} : { reason }),
    observedAt,
  });
}
