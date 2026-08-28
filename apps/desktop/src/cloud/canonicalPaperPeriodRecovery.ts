import type { CanonicalPaperRealizedPeriodInput } from "./canonicalPaperPeriodProjection";
import { projectCanonicalPaperRealizedPeriod } from "./canonicalPaperPeriodProjection";
import type { PersistedPaperPeriodEnvelope } from "./persistedPaperPeriodStore";

export interface CanonicalClosedPaperPeriodSource {
  /**
   * Returns only periods whose canonical PAPER lifecycle close is already durable.
   * The source remains the authority for crash recovery; this coordinator never
   * manufactures lifecycle completion from pending projection state.
   */
  listDurablyClosedPeriods(): readonly CanonicalPaperRealizedPeriodInput[];
}

export interface PersistedPaperPeriodProjectionSink {
  list(): readonly PersistedPaperPeriodEnvelope[];
  append(envelope: PersistedPaperPeriodEnvelope): PersistedPaperPeriodEnvelope;
}

export type CanonicalPaperRecoveryRejection = Readonly<{
  periodIndex: number;
  reason: string;
}>;

export type CanonicalPaperRecoveryReport = Readonly<{
  scanned: number;
  alreadyProjected: number;
  projected: number;
  rejected: readonly CanonicalPaperRecoveryRejection[];
  authority: Readonly<{
    liveAuthority: "NONE";
    productionMutationAllowed: false;
    aiAuthority: "ZERO_AUTHORITY";
  }>;
}>;

/**
 * Replays the durable canonical PAPER close source into #885 on startup/recovery.
 * Deterministic record IDs from `projectCanonicalPaperRealizedPeriod` plus the
 * idempotent #885 append contract close the crash window where canonical close
 * commits successfully but projection persistence does not.
 *
 * Projection errors fail closed per period and are reported without deleting or
 * mutating canonical outcome evidence. No LIVE or production mutation authority
 * is introduced here.
 */
export function reconcileCanonicalPaperPeriodProjection(
  source: CanonicalClosedPaperPeriodSource,
  sink: PersistedPaperPeriodProjectionSink,
): CanonicalPaperRecoveryReport {
  const closed = [...source.listDurablyClosedPeriods()].sort((left, right) =>
    left.periodIndex - right.periodIndex || left.periodStartAt - right.periodStartAt,
  );
  const existingIds = new Set(sink.list().map((envelope) => envelope.record.recordId));
  let alreadyProjected = 0;
  let projected = 0;
  const rejected: CanonicalPaperRecoveryRejection[] = [];

  for (const period of closed) {
    try {
      const envelope = projectCanonicalPaperRealizedPeriod(period);
      if (existingIds.has(envelope.record.recordId)) {
        alreadyProjected += 1;
        continue;
      }
      sink.append(envelope);
      existingIds.add(envelope.record.recordId);
      projected += 1;
    } catch (error) {
      rejected.push(Object.freeze({
        periodIndex: period.periodIndex,
        reason: error instanceof Error ? error.message : "UNKNOWN_RECONCILIATION_FAILURE",
      }));
    }
  }

  return Object.freeze({
    scanned: closed.length,
    alreadyProjected,
    projected,
    rejected: Object.freeze(rejected),
    authority: Object.freeze({
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
  });
}
