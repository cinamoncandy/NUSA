import type { PromotionCommand } from "./candidatePromotion";
import {
  decideResearchFactoryOutcome,
  type ResearchFactoryDecision,
  type ResearchFactoryEvidence,
} from "./researchFactoryOutcome";

export type ResearchFactoryPromotionBridgeReason =
  | "QUALIFIED_FOR_LEAGUE"
  | "RESEARCH_FACTORY_REJECTED"
  | "RESEARCH_FACTORY_INSUFFICIENT"
  | "DECISION_EVIDENCE_MISMATCH";

export interface ResearchFactoryPromotionBridgeInput {
  readonly decision: ResearchFactoryDecision;
  readonly evidence: ResearchFactoryEvidence;
  readonly promotionCommandId: string;
  readonly expectedCurrentChampionCandidateId: string | null;
  readonly evidenceHash: string;
  readonly ownerActorRef: string;
  readonly requestedAt: number;
}

export interface ResearchFactoryPromotionBridgeResult {
  readonly eligibleForExistingPromotionBoundary: boolean;
  readonly reason: ResearchFactoryPromotionBridgeReason;
  readonly command: PromotionCommand | null;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const NON_EMPTY = /^.{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function sameReasons(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deny(reason: ResearchFactoryPromotionBridgeReason): ResearchFactoryPromotionBridgeResult {
  return Object.freeze({
    eligibleForExistingPromotionBoundary: false,
    reason,
    command: null,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

/**
 * Bridges the canonical #1094 Research Factory disposition into the existing candidate-promotion
 * boundary. This does not execute promotion and does not create a second promotion engine.
 * The canonical decision is recomputed from supplied evidence so a forged/stale decision cannot
 * manufacture promotion eligibility.
 */
export function bridgeResearchFactoryDecisionToPromotion(
  input: ResearchFactoryPromotionBridgeInput,
): ResearchFactoryPromotionBridgeResult {
  if (!input || typeof input !== "object") return deny("DECISION_EVIDENCE_MISMATCH");
  const decision = input.decision;
  if (!decision || typeof decision !== "object") return deny("DECISION_EVIDENCE_MISMATCH");

  let recomputed: ResearchFactoryDecision;
  try {
    recomputed = decideResearchFactoryOutcome({
      candidateId: decision.candidateId,
      evaluationId: decision.evaluationId,
      evidence: input.evidence,
    });
  } catch {
    return deny("DECISION_EVIDENCE_MISMATCH");
  }

  const safetyMetadataMatches =
    decision.authority === "PAPER_ONLY" &&
    decision.liveAuthority === "NONE" &&
    decision.productionMutationAllowed === false &&
    decision.aiAuthority === "ZERO_AUTHORITY";
  const decisionMatchesEvidence =
    decision.candidateId === recomputed.candidateId &&
    decision.evaluationId === recomputed.evaluationId &&
    decision.outcome === recomputed.outcome &&
    sameReasons(decision.reasons, recomputed.reasons) &&
    safetyMetadataMatches;

  if (!decisionMatchesEvidence) return deny("DECISION_EVIDENCE_MISMATCH");
  if (recomputed.outcome === "REJECTED") return deny("RESEARCH_FACTORY_REJECTED");
  if (recomputed.outcome === "INSUFFICIENT") return deny("RESEARCH_FACTORY_INSUFFICIENT");

  if (
    typeof input.promotionCommandId !== "string" || !NON_EMPTY.test(input.promotionCommandId) ||
    typeof input.ownerActorRef !== "string" || !NON_EMPTY.test(input.ownerActorRef) ||
    typeof input.evidenceHash !== "string" || !SHA256.test(input.evidenceHash) ||
    !Number.isSafeInteger(input.requestedAt) || input.requestedAt < 0 ||
    (input.expectedCurrentChampionCandidateId !== null &&
      (typeof input.expectedCurrentChampionCandidateId !== "string" || !NON_EMPTY.test(input.expectedCurrentChampionCandidateId)))
  ) {
    return deny("DECISION_EVIDENCE_MISMATCH");
  }

  const command: PromotionCommand = Object.freeze({
    promotionCommandId: input.promotionCommandId,
    expectedCurrentChampionCandidateId: input.expectedCurrentChampionCandidateId,
    candidateId: recomputed.candidateId,
    evidenceEvaluationId: recomputed.evaluationId,
    evidenceHash: input.evidenceHash,
    ownerActorRef: input.ownerActorRef,
    reason: "RESEARCH_FACTORY:QUALIFIED_FOR_LEAGUE",
    requestedAt: input.requestedAt,
  });

  return Object.freeze({
    eligibleForExistingPromotionBoundary: true,
    reason: "QUALIFIED_FOR_LEAGUE",
    command,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
