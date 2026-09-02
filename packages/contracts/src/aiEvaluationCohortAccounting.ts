/**
 * Immutable prediction-time eligible-cohort accounting for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "immutable prediction-
 * time eligible-cohort identity ... unresolved, censored, abstained, delisted, bankrupt, stale,
 * provider-missing, and otherwise difficult records remain represented in cohort accounting and
 * cannot be silently dropped after outcomes are known" requirement. A metric computed only from
 * the records that happened to resolve cleanly ("complete-case") looks precise but silently
 * discards exactly the hard cases (a symbol that went bankrupt before its outcome window closed,
 * a censored/abstained prediction) that are often the most informative about model quality --
 * this module makes that dropping structurally impossible to do unnoticed.
 */

export type CohortRecordStatus =
  | "RESOLVED" | "UNRESOLVED" | "CENSORED" | "ABSTAINED" | "DELISTED" | "BANKRUPT" | "STALE" | "PROVIDER_MISSING";

export interface CohortRecord {
  readonly predictionId: string;
  readonly status: CohortRecordStatus;
}

export type CohortAccountingResult =
  | {
      readonly resolved: true;
      readonly totalCohortSize: number;
      readonly resolvedCount: number;
      readonly statusCounts: Readonly<Record<CohortRecordStatus, number>>;
      /** RESOLVED / totalCohortSize -- the denominator is the full cohort, never just the resolved subset. */
      readonly coverageRatio: number;
    }
  | { readonly resolved: false; readonly reason: "EMPTY_COHORT" | "DUPLICATE_PREDICTION_ID" };

const ALL_STATUSES: readonly CohortRecordStatus[] =
  ["RESOLVED", "UNRESOLVED", "CENSORED", "ABSTAINED", "DELISTED", "BANKRUPT", "STALE", "PROVIDER_MISSING"];

/**
 * Computes full-cohort accounting over every record, regardless of status -- every record counts
 * toward totalCohortSize and its own status bucket, never just the RESOLVED ones. Fails closed on
 * an empty cohort or a duplicate predictionId (which would silently double- or under-count).
 */
export function computeCohortAccounting(records: readonly CohortRecord[]): CohortAccountingResult {
  if (records.length === 0) return { resolved: false, reason: "EMPTY_COHORT" };

  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.predictionId)) return { resolved: false, reason: "DUPLICATE_PREDICTION_ID" };
    seen.add(record.predictionId);
  }

  const statusCounts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0])) as Record<CohortRecordStatus, number>;
  for (const record of records) statusCounts[record.status] += 1;

  return {
    resolved: true,
    totalCohortSize: records.length,
    resolvedCount: statusCounts.RESOLVED,
    statusCounts: Object.freeze(statusCounts),
    coverageRatio: statusCounts.RESOLVED / records.length,
  };
}

/**
 * True only when every id in `fullCohortIds` (the prediction-time eligible cohort, frozen before
 * outcomes were known) appears exactly once in `records` -- the structural check that a
 * downstream metric's accounting did not silently drop a hard case after its outcome became
 * known (e.g. excluding a since-bankrupt symbol from the denominator rather than counting it).
 */
export function isFullCohortAccountedFor(fullCohortIds: readonly string[], records: readonly CohortRecord[]): boolean {
  if (fullCohortIds.length === 0) return false;
  const recordIds = new Map<string, number>();
  for (const record of records) recordIds.set(record.predictionId, (recordIds.get(record.predictionId) ?? 0) + 1);
  return fullCohortIds.every((id) => recordIds.get(id) === 1);
}
