import type { PersistedPaperCandidateProvenance } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperRealizedPeriodOpenInput } from "./paperRealizedPeriodProducer";
import {
  OWNER_BASELINE_CANDIDATE_ID,
  ownerBaselineAdvisory,
  ownerBaselineCandidateProvenance,
  ownerBaselineStrategySpec,
} from "./ownerBaselinePaperStrategy";

export interface OwnerBaselinePaperPeriodContext {
  readonly market: string;
  readonly periodIndex: number;
  readonly periodStartAt: number;
  readonly sourceCommitSha: string;
}

export function isOwnerBaselinePeriodStartAt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 24 * 60 * 60 * 1000;
}

export function buildOwnerBaselinePaperPeriodInput(context: OwnerBaselinePaperPeriodContext): PaperRealizedPeriodOpenInput {
  const market = context.market.trim().toUpperCase();
  const strategy = ownerBaselineStrategySpec(context.sourceCommitSha);
  const advisory: LeagueCapitalAllocationAdvisory = ownerBaselineAdvisory(market, context.periodStartAt);
  const provenance: PersistedPaperCandidateProvenance = ownerBaselineCandidateProvenance(market, strategy.specificationHash);
  return Object.freeze({
    periodId: `owner-baseline:${market}:${context.periodStartAt}`,
    periodIndex: context.periodIndex,
    advisory,
    candidateProvenance: Object.freeze([provenance]),
    market,
    periodStartAt: context.periodStartAt,
  });
}

export function isOwnerBaselinePeriodInput(input: PaperRealizedPeriodOpenInput): boolean {
  return input.candidateProvenance.length === 1
    && input.candidateProvenance[0]?.candidateId === OWNER_BASELINE_CANDIDATE_ID
    && input.periodId.startsWith("owner-baseline:");
}
