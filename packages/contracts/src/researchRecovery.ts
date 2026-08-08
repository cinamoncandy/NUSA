import type { CandidateLifecycleRecord, PromotionAuditRecord, PromotionResult } from "./candidatePromotion";

export interface ResearchRuntimeSnapshot {
  readonly schemaVersion: 1;
  readonly currentChampionCandidateId: string | null;
  readonly candidates: readonly CandidateLifecycleRecord[];
  readonly evaluationLedgerCount: number;
  readonly evaluationLedgerHead: string;
  readonly promotionAuditCount: number;
  readonly promotionAuditHead: string;
  readonly promotionCommandCount: number;
  readonly promotionCommands: readonly { readonly commandId: string; readonly payloadFingerprint: string; readonly result: PromotionResult }[];
  readonly stateDigest: string;
  readonly recoveredAt: number;
  readonly championAuthority: "PAPER_ONLY";
  readonly challengerAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface ResearchRecoveryResult {
  readonly status: "READY" | "FAIL_CLOSED";
  readonly snapshot: ResearchRuntimeSnapshot | null;
  readonly reasons: readonly string[];
}

export interface ResearchRecoveryAuditView extends PromotionAuditRecord {}

