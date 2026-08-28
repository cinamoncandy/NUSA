import { createHash } from "node:crypto";
import type { PaperForwardPeriodEvidence, PaperForwardPeriodStatus } from "../../../packages/contracts/src/paperForwardEvidence";
import type { SqliteDatabase } from "../../../packages/storage/src/index";

/**
 * Legacy compatibility types for the retired Cloud PAPER realized-period path.
 *
 * #889 requires the canonical #885 persisted PAPER-period store fed by genuinely realized,
 * candidate-specific PAPER/shadow outcomes. This legacy surface accepted caller-supplied returns
 * and costs and therefore must not create new evidence. Keep the types temporarily so downstream
 * callers fail closed instead of creating a second migration-breaking API transition.
 */
export interface PaperRealizedPeriodOpenInput {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly advisoryGeneratedAt: number;
  readonly periodStartAt: number;
}

export interface PaperRuntimeObservation {
  readonly observationId: string;
  readonly observedAt: number;
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "FAILED" | "DUPLICATE";
}

export interface PersistedPaperRealizedPeriodPlan extends PaperRealizedPeriodOpenInput {
  readonly schemaVersion: 1;
  readonly observationIds: readonly string[];
  readonly observations: readonly PaperRuntimeObservation[];
  readonly lastObservedAt?: number;
}

export interface PaperRealizedPeriodCloseInput {
  readonly periodId: string;
  readonly periodEndAt: number;
  readonly grossReturn: number;
  readonly turnover: number;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly status: PaperForwardPeriodStatus;
}

export interface PaperRealizedPeriodRepository {
  open(plan: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan;
  observe(periodId: string, observation: PaperRuntimeObservation): PersistedPaperRealizedPeriodPlan;
  realize(evidence: PaperForwardPeriodEvidence): PaperForwardPeriodEvidence;
  getRealized(periodId: string): PaperForwardPeriodEvidence | undefined;
  list(): readonly PaperForwardPeriodEvidence[];
  listOpen(): readonly PersistedPaperRealizedPeriodPlan[];
}

export class PaperRealizedPeriodProducerError extends Error {
  public constructor(readonly code: string, message: string, readonly periodId?: string) {
    super(message);
    this.name = "PaperRealizedPeriodProducerError";
  }
}

const RETIRED_CODE = "NON_CANONICAL_LEGACY_PRODUCER_DISABLED";
const RETIRED_MESSAGE = "legacy PAPER realized-period writer is retired; use the canonical #885 lifecycle producer";

function retired(periodId?: string): never {
  throw new PaperRealizedPeriodProducerError(RETIRED_CODE, RETIRED_MESSAGE, periodId);
}

/**
 * Compatibility shell only. It deliberately performs no CREATE/INSERT/UPDATE operations against
 * the former `paper_realized_periods` table. Existing migrations/data remain untouched so deployed
 * databases can upgrade safely, but this repository can no longer manufacture or mutate evidence.
 */
export class SqlitePaperRealizedPeriodRepository implements PaperRealizedPeriodRepository {
  public constructor(_db: SqliteDatabase, maximumPeriods = 100) {
    if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) {
      throw new PaperRealizedPeriodProducerError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
    }
  }

  public open(plan: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan { return retired(plan.periodId); }
  public observe(periodId: string, _observation: PaperRuntimeObservation): PersistedPaperRealizedPeriodPlan { return retired(periodId); }
  public realize(evidence: PaperForwardPeriodEvidence): PaperForwardPeriodEvidence { return retired(evidence.periodId); }
  public getRealized(_periodId: string): PaperForwardPeriodEvidence | undefined { return undefined; }
  public list(): readonly PaperForwardPeriodEvidence[] { return Object.freeze([]); }
  public listOpen(): readonly PersistedPaperRealizedPeriodPlan[] { return Object.freeze([]); }
}

/**
 * Retired facade retained only to keep runtime/API callers fail-closed during the transition to
 * the canonical #885/#877 path. `observeExecution` is intentionally a no-op because normal PAPER
 * ticks must not write to the legacy store; open/close reject explicitly so callers cannot mistake
 * this path for canonical evidence production.
 */
export class PaperRealizedPeriodProducer {
  public constructor(_repository: PaperRealizedPeriodRepository) {}

  public openPeriod(input: PaperRealizedPeriodOpenInput): PersistedPaperRealizedPeriodPlan {
    return retired(input.periodId);
  }

  public observeExecution(_observation: PaperRuntimeObservation): "RECORDED" | "DUPLICATE" | "NO_ACTIVE_PERIOD" {
    return "NO_ACTIVE_PERIOD";
  }

  public closePeriod(input: PaperRealizedPeriodCloseInput): PaperForwardPeriodEvidence {
    return retired(input.periodId);
  }

  public listRealizedPeriods(): readonly PaperForwardPeriodEvidence[] { return Object.freeze([]); }
  public listOpenPeriods(): readonly PersistedPaperRealizedPeriodPlan[] { return Object.freeze([]); }
}

/** Stable diagnostic identity retained for existing PAPER runtime telemetry only. */
export function paperExecutionObservationId(market: string, observedAt: number, status: string): string {
  const normalized = JSON.stringify({ market: market.trim().toUpperCase(), observedAt, status });
  return `paper-runtime:${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32)}`;
}
