import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { ShadowAllocationPeriodInput } from "./shadowAllocationEvaluation";

export interface PersistedPaperPeriodRecord {
  readonly recordId: string;
  readonly periodIndex: number;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly realizedReturns: Readonly<Record<string, number>>;
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
}

export interface PersistedPaperPeriodAdapterResult {
  readonly periods: readonly ShadowAllocationPeriodInput[];
  readonly appliedRecordIds: readonly string[];
  readonly skippedDuplicateRecordIds: readonly string[];
}

export class PersistedPaperPeriodAdapterError extends Error {
  constructor(readonly code: string, message: string, readonly recordId?: string) {
    super(message);
    this.name = "PersistedPaperPeriodAdapterError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, code: string, message: string, recordId: string): void {
  if (!Number.isFinite(value)) throw new PersistedPaperPeriodAdapterError(code, message, recordId);
}

/**
 * Point-in-time safe transform from durable realized PAPER records into the existing shadow
 * evaluator. It owns no metric or persistence logic. Replay is idempotent by recordId and every
 * supplied outcome is retained; malformed chronology, identity joins, or cost evidence fail closed.
 */
export function adaptPersistedPaperPeriods(
  records: readonly PersistedPaperPeriodRecord[],
  alreadyAppliedRecordIds: ReadonlySet<string> = new Set(),
): PersistedPaperPeriodAdapterResult {
  const seenInThisCall = new Set<string>();
  const applied: string[] = [];
  const skippedDuplicates: string[] = [];
  const periods: ShadowAllocationPeriodInput[] = [];
  let previousAppliedPeriodEndAt: number | undefined;

  const ordered = [...records].sort((left, right) => left.periodIndex - right.periodIndex);

  for (const record of ordered) {
    if (!record.recordId.trim()) throw new PersistedPaperPeriodAdapterError("INVALID_RECORD_ID", "persisted period record requires a non-empty recordId");
    if (seenInThisCall.has(record.recordId)) throw new PersistedPaperPeriodAdapterError("DUPLICATE_RECORD_ID_IN_BATCH", `recordId ${record.recordId} appears twice in one adapter call`, record.recordId);
    seenInThisCall.add(record.recordId);

    if (alreadyAppliedRecordIds.has(record.recordId)) {
      skippedDuplicates.push(record.recordId);
      continue;
    }

    if (record.advisory.schemaVersion !== 1) throw new PersistedPaperPeriodAdapterError("UNSUPPORTED_ADVISORY_SCHEMA", `record ${record.recordId} advisory schema is unsupported`, record.recordId);
    if (!Number.isInteger(record.periodIndex) || record.periodIndex < 0) throw new PersistedPaperPeriodAdapterError("INVALID_PERIOD_INDEX", `record ${record.recordId} periodIndex must be a non-negative integer`, record.recordId);
    assertFinite(record.periodStartAt, "NON_FINITE_PERIOD_BOUND", `record ${record.recordId} periodStartAt must be finite`, record.recordId);
    assertFinite(record.periodEndAt, "NON_FINITE_PERIOD_BOUND", `record ${record.recordId} periodEndAt must be finite`, record.recordId);
    if (record.periodEndAt <= record.periodStartAt) throw new PersistedPaperPeriodAdapterError("INVALID_PERIOD_BOUNDS", `record ${record.recordId} periodEndAt must be after periodStartAt`, record.recordId);
    if (previousAppliedPeriodEndAt != null && record.periodStartAt < previousAppliedPeriodEndAt) {
      throw new PersistedPaperPeriodAdapterError("NON_MONOTONIC_PERIOD_CHRONOLOGY", `record ${record.recordId} overlaps or moves backward relative to the preceding PAPER period`, record.recordId);
    }

    const advisoryAt = Date.parse(record.advisory.generatedAt);
    if (!Number.isFinite(advisoryAt)) throw new PersistedPaperPeriodAdapterError("INVALID_ADVISORY_TIMESTAMP", `record ${record.recordId} advisory.generatedAt is not a valid timestamp`, record.recordId);
    if (advisoryAt >= record.periodStartAt) throw new PersistedPaperPeriodAdapterError("LOOKAHEAD_ADVISORY_SNAPSHOT", `record ${record.recordId} advisory was generated at or after the realized period it is scored against`, record.recordId);

    const advisoryIds = new Set(record.advisory.entries.map((entry) => entry.id));
    const returnIds = new Set(Object.keys(record.realizedReturns));
    for (const id of advisoryIds) if (!returnIds.has(id)) throw new PersistedPaperPeriodAdapterError("MISSING_REALIZED_RETURN_FOR_ADVISORY_ENTRY", `record ${record.recordId} has no realized return for allocated candidate ${id}`, record.recordId);
    for (const id of returnIds) if (!advisoryIds.has(id)) throw new PersistedPaperPeriodAdapterError("UNKNOWN_REALIZED_RETURN_CANDIDATE", `record ${record.recordId} realized return for ${id} does not correspond to any advisory entry`, record.recordId);

    for (const [id, value] of Object.entries(record.realizedReturns)) assertFinite(value, "NON_FINITE_REALIZED_RETURN", `record ${record.recordId} candidate ${id} realized return must be finite`, record.recordId);
    assertFinite(record.benchmarkReturn, "NON_FINITE_BENCHMARK_RETURN", `record ${record.recordId} benchmarkReturn must be finite`, record.recordId);
    assertFinite(record.turnoverCostRate, "NON_FINITE_COST_RATE", `record ${record.recordId} turnoverCostRate must be finite`, record.recordId);
    if (record.turnoverCostRate < 0) throw new PersistedPaperPeriodAdapterError("NEGATIVE_COST_RATE", `record ${record.recordId} turnoverCostRate must be non-negative`, record.recordId);

    periods.push(freeze({ periodIndex: record.periodIndex, advisory: record.advisory, realizedReturns: freeze({ ...record.realizedReturns }), benchmarkReturn: record.benchmarkReturn, turnoverCostRate: record.turnoverCostRate }));
    applied.push(record.recordId);
    previousAppliedPeriodEndAt = record.periodEndAt;
  }

  return freeze({ periods: freeze(periods), appliedRecordIds: freeze(applied), skippedDuplicateRecordIds: freeze(skippedDuplicates) });
}
