import type { StrategyLifecycle } from "./strategyGovernance";

export interface ResearchCandidateIdentity {
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly artifactHash: string;
  readonly configHash: string;
  readonly createdAt: number;
  readonly originatingEvaluationId: string;
  readonly originatingInputHash: string;
  readonly authority: "PAPER_ONLY";
  readonly paperOnly: true;
}

export interface CandidateLifecycleRecord {
  readonly identity: ResearchCandidateIdentity;
  readonly lifecycle: StrategyLifecycle;
}

export interface PromotionCommand {
  readonly promotionCommandId: string;
  readonly expectedCurrentChampionCandidateId: string | null;
  readonly candidateId: string;
  readonly evidenceEvaluationId: string;
  readonly evidenceHash: string;
  readonly ownerActorRef: string;
  readonly reason: string;
  readonly requestedAt: number;
}

export type PromotionResultStatus = "PROMOTED" | "REJECTED" | "CONFLICT" | "DUPLICATE";

export interface PromotionResult {
  readonly status: PromotionResultStatus;
  readonly promotionCommandId: string;
  readonly reason: string;
  readonly previousChampionCandidateId: string | null;
  readonly resultingChampionCandidateId: string | null;
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

export interface PromotionAuditRecord {
  readonly promotionCommandId: string;
  readonly candidate: ResearchCandidateIdentity | null;
  readonly previousChampionCandidateId: string | null;
  readonly resultingChampionCandidateId: string | null;
  readonly evidenceEvaluationId: string;
  readonly evidenceHash: string;
  readonly actorRef: string;
  readonly requestedAt: number;
  readonly committedAt: number;
  readonly result: PromotionResultStatus;
  readonly rejectionReason: string | null;
  readonly previousAuditHash: string;
  readonly currentAuditHash: string;
}

