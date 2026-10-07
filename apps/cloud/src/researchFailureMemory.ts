import type { ResearchComparisonEvidence } from "../../../packages/contracts/src/researchRuntime";

/**
 * Bounded reasons a Research challenger did not beat the champion. They are derived on read from the evaluation evidence the
 * Research ledger already stores durably (result, reason, champion and challenger metrics, cost evidence), so there is no second
 * store and a failed candidate is never deleted. Display and Research N+1 bookkeeping only: this never promotes, trades or
 * changes a threshold.
 */
export const RESEARCH_FAILURE_REASONS = Object.freeze(["NO_EDGE", "LOW_SAMPLE", "COST_SENSITIVE", "EXCESSIVE_DRAWDOWN", "EXECUTION_MISMATCH"] as const);
export type ResearchFailureReason = (typeof RESEARCH_FAILURE_REASONS)[number];

/** Reasons the coordinator records when a comparison actually ran on complete metrics (anything else means the evidence was unusable). */
const COMPLETED_COMPARISON_REASONS: ReadonlySet<string> = new Set(["MULTI_METRIC_COMPARISON", "NET_RETURN_COMPARISON"]);

const metric = (record: Readonly<Record<string, number>> | undefined, key: string): number | null => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * Null when the challenger won (nothing failed). Otherwise exactly one reason, in a fixed priority so the same evidence always
 * gives the same answer:
 * 1. LOW_SAMPLE: the comparison could not run on usable evidence (an evaluation or its net return is missing, or the coordinator
 *    recorded an incomplete or invalid comparison). A comparison that ran but found no clear winner is NOT low sample.
 * 2. COST_SENSITIVE: the cost evidence shows a positive gross return that costs turned into a non-positive net return.
 * 3. EXCESSIVE_DRAWDOWN: the challenger's maximum drawdown is worse than the champion's.
 * 4. EXECUTION_MISMATCH: the challenger's execution quality is below the champion's.
 * 5. NO_EDGE: none of the above; it simply did not beat the champion.
 */
export function classifyResearchFailure(evidence: Pick<ResearchComparisonEvidence, "result" | "reason" | "champion" | "challenger" | "costEvidence">): ResearchFailureReason | null {
  if (evidence.result === "CHALLENGER_BETTER") return null;
  const challenger = evidence.challenger?.metrics, champion = evidence.champion?.metrics;
  if (evidence.challenger == null || evidence.champion == null || metric(challenger, "netReturn") == null || !COMPLETED_COMPARISON_REASONS.has(evidence.reason)) return "LOW_SAMPLE";
  const cost = evidence.costEvidence;
  if (cost != null && Number.isFinite(cost.grossReturn) && Number.isFinite(cost.netReturn) && cost.grossReturn > 0 && cost.netReturn <= 0) return "COST_SENSITIVE";
  const drawdown = metric(challenger, "maximumDrawdown"), championDrawdown = metric(champion, "maximumDrawdown");
  if (drawdown != null && championDrawdown != null && drawdown > championDrawdown) return "EXCESSIVE_DRAWDOWN";
  const quality = metric(challenger, "executionQuality"), championQuality = metric(champion, "executionQuality");
  if (quality != null && championQuality != null && quality < championQuality) return "EXECUTION_MISMATCH";
  return "NO_EDGE";
}

/**
 * All-time failure counts for one set of ledger records (the caller chooses the interval and validation role), keyed FAIL_<reason>.
 * Pure and recomputed from the durable ledger, so a restart or a crash between an append and a count never loses or double counts one.
 */
export function countResearchFailures(records: readonly Pick<ResearchComparisonEvidence, "result" | "reason" | "champion" | "challenger" | "costEvidence">[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const reason = classifyResearchFailure(record);
    if (reason != null) counts[`FAIL_${reason}`] = (counts[`FAIL_${reason}`] ?? 0) + 1;
  }
  return Object.freeze(counts);
}
