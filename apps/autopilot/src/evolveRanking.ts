import type { EvolutionOpportunity } from "./evolveOpportunity";

export interface EvolutionPriority {
  readonly opportunityId: string;
  readonly score: number;
  readonly evidenceQuality: number;
  readonly eligible: boolean;
  readonly reason: string;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function rankEvolutionOpportunity(opportunity: EvolutionOpportunity): EvolutionPriority {
  const evidenceQuality = opportunity.evidence.length === 0
    ? 0
    : opportunity.evidence.reduce((sum, item) => sum + clamp(item.quality), 0) / opportunity.evidence.length;
  const eligible =
    opportunity.status === "DISCOVERED" || opportunity.status === "READY";
  const rawScore =
    opportunity.impact *
    opportunity.confidence *
    evidenceQuality *
    opportunity.reversibility /
    Math.max(opportunity.risk, 0.05);
  // Ineligible opportunities remain observable, but must never outrank work
  // that can actually be selected for execution.
  const score = eligible && Number.isFinite(rawScore) ? rawScore : 0;
  return Object.freeze({
    opportunityId: opportunity.id,
    score,
    evidenceQuality,
    eligible,
    reason: eligible ? "bounded-evidence-priority" : "opportunity-status-not-rankable",
  });
}

export function rankEvolutionOpportunities(opportunities: readonly EvolutionOpportunity[]): readonly EvolutionPriority[] {
  return Object.freeze([...opportunities]
    .map(rankEvolutionOpportunity)
    .sort((left, right) => right.score - left.score || left.opportunityId.localeCompare(right.opportunityId)));
}
