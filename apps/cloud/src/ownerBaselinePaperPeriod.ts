import type { PersistedPaperCandidateProvenance } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperRealizedPeriodOpenInput } from "./paperRealizedPeriodProducer";
import { isDeepStrictEqual } from "node:util";
import {
  OWNER_BASELINE_CODE_IDENTITY,
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
  try {
    if (!isOwnerBaselinePeriodStartAt(input.periodStartAt) || !Number.isSafeInteger(input.periodIndex) || input.periodIndex < 0) return false;
    const market = input.market;
    if (typeof market !== "string" || !/^KRW-[A-Z0-9-]+$/.test(market)) return false;
    const expected = ownerBaselineCandidateProvenance(market, ownerBaselineStrategySpec(OWNER_BASELINE_CODE_IDENTITY).specificationHash);
    if (!isDeepStrictEqual(input.candidateProvenance, [expected])) return false;
    const generatedAt = Date.parse(input.advisory.generatedAt);
    if (!Number.isSafeInteger(generatedAt) || generatedAt >= input.periodStartAt || new Date(generatedAt).toISOString() !== input.advisory.generatedAt) return false;
    // Continuations preserve their original immutable advisory, not a newly minted day identity.
    if (!isDeepStrictEqual(input.advisory, ownerBaselineAdvisory(market, generatedAt + 1))) return false;
    return input.periodId === `owner-baseline:${market}:${input.periodStartAt}`
      || ["closed-learning-rollover", "closed-learning-mixed-binding-replaced", "closed-learning-account-replaced"].some(prefix => input.periodId === `${prefix}:${input.periodIndex}:${input.periodStartAt}`);
  } catch { return false; }
}
