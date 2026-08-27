import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { ShadowAllocationPeriodInput } from "./shadowAllocationEvaluation";

/**
 * Point-in-time safe adapter from persisted realized PAPER periods to shadow-allocation input.
 *
 * shadowAllocationEvaluation.ts already evaluates a longitudinal PAPER period sequence, but
 * nothing turned a real, persisted history of "an allocation advisory was issued, then a period
 * of real PAPER trading happened" into that sequence. This is that adapter, and only that: it
 * computes no new metric, defines no new evaluation, and does not read or write any persistence
 * store itself -- it is a pure, testable transform that whatever real persistence layer exists
 * can call, so the actual storage schema stays a runtime/persistence-layer concern rather than
 * being invented here.
 *
 * Deliberately paranoid about the exact failure modes real replay/idempotency introduces:
 *
 * - Point-in-time safety: an advisory computed AT OR AFTER the realized period it is scored
 *   against is look-ahead by construction (the weights could have used information from the very
 *   period being evaluated) and is rejected, never silently accepted.
 * - Identity linkage: every realized-return key must correspond to a real advisory entry, and
 *   every advisory entry must have a realized return. A stray or missing key is not evidence of
 *   zero return -- it is evidence the join between League advisory and realized PAPER outcome is
 *   broken, and must block rather than be filled in.
 * - Idempotent replay: persisted records carry a stable recordId. Re-supplying the same recordId
 *   (e.g. after a runtime restart re-reads history from disk) is detected and skipped rather than
 *   double-counted, without requiring the caller to already know what was previously applied.
 * - No survivorship-by-retention: this performs no filtering by period outcome/status. Whatever
 *   periods are supplied are all converted; a real persistence layer must supply failed/halted
 *   periods too; this adapter has no mechanism to drop them and does not need one.
 */

export interface PersistedPaperPeriodRecord {
  /** Stable, globally unique id for this persisted period record -- the idempotent replay key. */
  readonly recordId: string;
  readonly periodIndex: number;
  /** The allocation advisory as it existed when issued, snapshot time taken from its own generatedAt. */
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly realizedReturns: Readonly<Record<string, number>>;
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
}

export interface PersistedPaperPeriodAdapterResult {
  /** Chronologically ordered, ready to pass to evaluateShadowAllocation. */
  readonly periods: readonly ShadowAllocationPeriodInput[];
  /** recordIds actually converted this call. */
  readonly appliedRecordIds: readonly string[];
  /** recordIds present in alreadyAppliedRecordIds and skipped rather than double-counted. */
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
 * Converts persisted realized PAPER period records into shadow-allocation evaluation input.
 * Fails closed on look-ahead, broken candidate identity linkage, or malformed evidence; skips
 * (never re-applies) records whose recordId was already applied in a prior call.
 */
export function adaptPersistedPaperPeriods(
  records: readonly PersistedPaperPeriodRecord[],
  alreadyAppliedRecordIds: ReadonlySet<string> = new Set(),
): PersistedPaperPeriodAdapterResult {
  const seenInThisCall = new Set<string>();
  const applied: string[] = [];
  const skippedDuplicates: string[] = [];
  const periods: ShadowAllocationPeriodInput[] = [];

  const ordered = [...records].sort((left, right) => left.periodIndex - right.periodIndex);

  for (const record of ordered) {
    if (!record.recordId.trim()) {
      throw new PersistedPaperPeriodAdapterError("INVALID_RECORD_ID", "persisted period record requires a non-empty recordId");
    }
    if (seenInThisCall.has(record.recordId)) {
      throw new PersistedPaperPeriodAdapterError("DUPLICATE_RECORD_ID_IN_BATCH", `recordId ${record.recordId} appears twice in one adapter call`, record.recordId);
    }
    seenInThisCall.add(record.recordId);

    if (alreadyAppliedRecordIds.has(record.recordId)) {
      skippedDuplicates.push(record.recordId);
      continue;
    }

    if (record.advisory.schemaVersion !== 1) {
      throw new PersistedPaperPeriodAdapterError("UNSUPPORTED_ADVISORY_SCHEMA", `record ${record.recordId} advisory schema is unsupported`, record.recordId);
    }
    if (!Number.isInteger(record.periodIndex) || record.periodIndex < 0) {
      throw new PersistedPaperPeriodAdapterError("INVALID_PERIOD_INDEX", `record ${record.recordId} periodIndex must be a non-negative integer`, record.recordId);
    }
    assertFinite(record.periodStartAt, "NON_FINITE_PERIOD_BOUND", `record ${record.recordId} periodStartAt must be finite`, record.recordId);
    assertFinite(record.periodEndAt, "NON_FINITE_PERIOD_BOUND", `record ${record.recordId} periodEndAt must be finite`, record.recordId);
    if (record.periodEndAt <= record.periodStartAt) {
      throw new PersistedPaperPeriodAdapterError("INVALID_PERIOD_BOUNDS", `record ${record.recordId} periodEndAt must be after periodStartAt`, record.recordId);
    }

    // Point-in-time safety: an advisory computed at or after the period it is being scored
    // against could have used that very period's data -- reject rather than silently accept it
    // as forward evidence.
    const advisoryAt = Date.parse(record.advisory.generatedAt);
    if (!Number.isFinite(advisoryAt)) {
      throw new PersistedPaperPeriodAdapterError("INVALID_ADVISORY_TIMESTAMP", `record ${record.recordId} advisory.generatedAt is not a valid timestamp`, record.recordId);
    }
    if (advisoryAt >= record.periodStartAt) {
      throw new PersistedPaperPeriodAdapterError(
        "LOOKAHEAD_ADVISORY_SNAPSHOT",
        `record ${record.recordId} advisory was generated at or after the realized period it is scored against`,
        record.recordId,
      );
    }

    // Identity linkage: the join between advisory and realized outcome must be exact in both
    // directions, or the "evidence" does not actually describe what the advisory allocated to.
    const advisoryIds = new Set(record.advisory.entries.map((entry) => entry.id));
    const returnIds = new Set(Object.keys(record.realizedReturns));
    for (const id of advisoryIds) {
      if (!returnIds.has(id)) {
        throw new PersistedPaperPeriodAdapterError("MISSING_REALIZED_RETURN_FOR_ADVISORY_ENTRY", `record ${record.recordId} has no realized return for allocated candidate ${id}`, record.recordId);
      }
    }
    for (const id of returnIds) {
      if (!advisoryIds.has(id)) {
        throw new PersistedPaperPeriodAdapterError("UNKNOWN_REALIZED_RETURN_CANDIDATE", `record ${record.recordId} realized return for ${id} does not correspond to any advisory entry`, record.recordId);
      }
    }

    assertFinite(record.benchmarkReturn, "NON_FINITE_BENCHMARK_RETURN", `record ${record.recordId} benchmarkReturn must be finite`, record.recordId);
    assertFinite(record.turnoverCostRate, "NON_FINITE_COST_RATE", `record ${record.recordId} turnoverCostRate must be finite`, record.recordId);
    if (record.turnoverCostRate < 0) {
      throw new PersistedPaperPeriodAdapterError("NEGATIVE_COST_RATE", `record ${record.recordId} turnoverCostRate must be non-negative`, record.recordId);
    }

    periods.push(freeze({
      periodIndex: record.periodIndex,
      advisory: record.advisory,
      realizedReturns: freeze({ ...record.realizedReturns }),
      benchmarkReturn: record.benchmarkReturn,
      turnoverCostRate: record.turnoverCostRate,
    }));
    applied.push(record.recordId);
  }

  return freeze({
    periods: freeze(periods),
    appliedRecordIds: freeze(applied),
    skippedDuplicateRecordIds: freeze(skippedDuplicates),
  });
}
