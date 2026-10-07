import type { ResearchComparisonEvidence } from "../../../packages/contracts/src/researchRuntime";

/**
 * Bounded reasons a Research challenger did not beat the champion. They are derived on read from the evaluation evidence the
 * Research ledger already stores durably (result, champion and challenger metrics), so there is no second store and a failed
 * candidate is never deleted. Display and Research N+1 bookkeeping only: this never promotes, trades or changes a threshold.
 */
export const RESEARCH_FAILURE_REASONS = Object.freeze(["NO_EDGE", "LOW_SAMPLE", "COST_SENSITIVE", "EXCESSIVE_DRAWDOWN", "EXECUTION_MISMATCH"] as const);
export type ResearchFailureReason = (typeof RESEARCH_FAILURE_REASONS)[number];

const metric = (record: Readonly<Record<string, number>> | undefined, key: string): number | null => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * Null when the challenger won (nothing failed). Otherwise exactly one reason, in a fixed priority so the same evidence always
 * gives the same answer:
 * 1. LOW_SAMPLE: the comparison was INCONCLUSIVE or an evaluation or its net return is missing (not enough evidence to separate them).
 * 2. COST_SENSITIVE: the challenger earned before costs (net return above zero) but not after (cost-adjusted return at or below zero).
 * 3. EXCESSIVE_DRAWDOWN: the challenger's maximum drawdown is worse than the champion's.
 * 4. EXECUTION_MISMATCH: the challenger's execution quality is below the champion's.
 * 5. NO_EDGE: none of the above; it simply did not beat the champion.
 */
export function classifyResearchFailure(evidence: Pick<ResearchComparisonEvidence, "result" | "champion" | "challenger">): ResearchFailureReason | null {
  if (evidence.result === "CHALLENGER_BETTER") return null;
  const challenger = evidence.challenger?.metrics, champion = evidence.champion?.metrics;
  const netReturn = metric(challenger, "netReturn");
  if (evidence.result === "INCONCLUSIVE" || evidence.challenger == null || evidence.champion == null || netReturn == null) return "LOW_SAMPLE";
  const adjusted = metric(challenger, "costAdjustedReturn");
  if (netReturn > 0 && adjusted != null && adjusted <= 0) return "COST_SENSITIVE";
  const drawdown = metric(challenger, "maximumDrawdown"), championDrawdown = metric(champion, "maximumDrawdown");
  if (drawdown != null && championDrawdown != null && drawdown > championDrawdown) return "EXCESSIVE_DRAWDOWN";
  const quality = metric(challenger, "executionQuality"), championQuality = metric(champion, "executionQuality");
  if (quality != null && championQuality != null && quality < championQuality) return "EXECUTION_MISMATCH";
  return "NO_EDGE";
}
