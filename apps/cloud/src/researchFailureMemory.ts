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

export interface StrategyFailureHistory {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly evaluations: number;
  readonly failures: number;
  readonly byReason: Readonly<Record<string, number>>;
  /** The reason of the most recent failure, or null when the latest evaluation won. */
  readonly lastReason: ResearchFailureReason | null;
  /** How many of the most recent evaluations in a row failed for exactly `lastReason` (0 when the latest evaluation won). */
  readonly repeatStreak: number;
}

type HistoryRecord = Pick<ResearchComparisonEvidence, "result" | "reason" | "champion" | "challenger" | "costEvidence" | "evaluationTimestamp" | "evaluationId" | "strategyId" | "strategyVersion">;

/**
 * Per-challenger failure history recomputed from the durable evaluation records, in evaluation-time order (evaluationId breaks ties,
 * so the same records always give the same answer). A failed candidate is never deleted; this only lets Research N+1 say which
 * variant keeps failing for which bounded reason. Report/display only: it changes no schedule, budget or threshold.
 */
export function summarizeStrategyFailureHistory(records: readonly HistoryRecord[]): readonly StrategyFailureHistory[] {
  const ordered = [...records].sort((a, b) => a.evaluationTimestamp - b.evaluationTimestamp || (a.evaluationId < b.evaluationId ? -1 : a.evaluationId > b.evaluationId ? 1 : 0));
  const byStrategy = new Map<string, { strategyId: string; strategyVersion: string; reasons: (ResearchFailureReason | null)[] }>();
  for (const record of ordered) {
    // The record's own strategyId/strategyVersion is the REQUESTED challenger and is kept even when the evaluator threw (challenger null)
    // or returned a different identity, so a failure is always charged to the strategy that was actually under test.
    if (typeof record.strategyId !== "string" || record.strategyId === "" || typeof record.strategyVersion !== "string" || record.strategyVersion === "") continue;
    const key = `${record.strategyId}@${record.strategyVersion}`;
    const entry = byStrategy.get(key) ?? { strategyId: record.strategyId, strategyVersion: record.strategyVersion, reasons: [] };
    entry.reasons.push(classifyResearchFailure(record));
    byStrategy.set(key, entry);
  }
  return Object.freeze([...byStrategy.values()].map((entry) => {
    const byReason: Record<string, number> = {};
    for (const reason of entry.reasons) if (reason != null) byReason[reason] = (byReason[reason] ?? 0) + 1;
    const last = entry.reasons[entry.reasons.length - 1] ?? null;
    let repeatStreak = 0;
    if (last != null) for (let index = entry.reasons.length - 1; index >= 0 && entry.reasons[index] === last; index -= 1) repeatStreak += 1;
    return Object.freeze({
      strategyId: entry.strategyId,
      strategyVersion: entry.strategyVersion,
      evaluations: entry.reasons.length,
      failures: entry.reasons.filter((reason) => reason != null).length,
      byReason: Object.freeze(byReason),
      lastReason: last,
      repeatStreak,
    });
  }).sort((a, b) => (a.strategyId < b.strategyId ? -1 : a.strategyId > b.strategyId ? 1 : a.strategyVersion < b.strategyVersion ? -1 : a.strategyVersion > b.strategyVersion ? 1 : 0)));
}

/** REPEAT_<reason> = how many challengers' latest `threshold`+ evaluations in a row failed for that same reason. Integers only, bounded keys. */
export function countRepeatedFailures(history: readonly StrategyFailureHistory[], threshold = 2): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of history) {
    if (item.lastReason != null && item.repeatStreak >= threshold) counts[`REPEAT_${item.lastReason}`] = (counts[`REPEAT_${item.lastReason}`] ?? 0) + 1;
  }
  return Object.freeze(counts);
}
