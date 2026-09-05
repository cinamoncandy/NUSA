import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { tradingDayKey } from "../../../packages/contracts/src/risk-safety-integration";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PaperRealizedPeriodOpenInput, PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";

export type ClosedLearningRolloverStatus =
  | "NO_OPEN_PERIOD"
  | "WAITING_FOR_CANONICAL_BOUNDARY"
  | "WAITING_FOR_KST_DAY_ROLLOVER"
  | "WAITING_FOR_REALIZED_FILL"
  | "CLOSED_AND_EVALUATED"
  | "BLOCKED";

export interface ClosedLearningRolloverResult {
  readonly status: ClosedLearningRolloverStatus;
  readonly periodId?: string;
  readonly reason?: string;
  readonly cycle?: ClosedLearningCycleResult;
}

export interface ClosedLearningEvidenceWindow {
  readonly closedPeriod: PersistedPaperPeriodEnvelope;
  readonly realizedPeriods: readonly PersistedPaperPeriodEnvelope[];
}

export interface ClosedLearningRolloverPort {
  readonly listOpenPeriods: () => readonly PersistedPaperRealizedPeriodPlan[];
  readonly listRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly closePeriodFromCanonicalAccount: (input: { readonly periodId: string; readonly periodEndAt: number }) => PersistedPaperPeriodEnvelope;
  readonly openPeriodFromCanonicalAccount: (input: PaperRealizedPeriodOpenInput) => PersistedPaperRealizedPeriodPlan;
  readonly buildEvidenceIdentity: (window: ClosedLearningEvidenceWindow) => ClosedLearningEvidenceIdentity;
  readonly runClosedLearningCycle: (identity: ClosedLearningEvidenceIdentity) => ClosedLearningCycleResult;
}

function nextPeriodIndex(periods: readonly PersistedPaperPeriodEnvelope[]): number {
  const maximum = periods.reduce((value, item) => Math.max(value, item.record.periodIndex), -1);
  if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) {
    throw new Error("closed-learning rollover period index is unavailable");
  }
  return maximum + 1;
}

function hasRealizedFill(plan: PersistedPaperRealizedPeriodPlan): boolean {
  return plan.observations.some((item) => item.status === "FILLED");
}

function stableOpenPeriods(input: readonly PersistedPaperRealizedPeriodPlan[]): readonly PersistedPaperRealizedPeriodPlan[] {
  return Object.freeze([...input].sort((left, right) => left.periodIndex - right.periodIndex || left.periodId.localeCompare(right.periodId)));
}

/**
 * Production-safe closed-learning rollover boundary.
 *
 * This scheduler never invents a wall-clock account snapshot. It may close a period only at the
 * exact canonical PAPER account `updatedAt`, and only after that boundary has crossed the existing
 * Asia/Seoul trading-day boundary. A period without a real FILLED observation remains open.
 *
 * Evidence identity construction is deliberately injected: source commit, cost model, risk hash,
 * champion identity, evidence fingerprints, and which realized periods belong to one immutable
 * Research lineage must come from authoritative durable provenance. The scheduler passes the
 * complete realized denominator to that builder and refuses to synthesize any identity itself.
 */
export class ClosedLearningRolloverScheduler {
  public constructor(private readonly port: ClosedLearningRolloverPort) {}

  public runOnce(): ClosedLearningRolloverResult {
    const periods = stableOpenPeriods(this.port.listOpenPeriods());
    if (periods.length === 0) return Object.freeze({ status: "NO_OPEN_PERIOD" });
    if (periods.length > 1) return Object.freeze({ status: "BLOCKED", reason: "MULTIPLE_OPEN_PAPER_PERIODS" });

    const plan = periods[0]!;
    const account = this.port.readCanonicalPaperAccount();
    if (account == null || account.version !== 1 || !Number.isSafeInteger(account.updatedAt) || account.updatedAt < 0) {
      return Object.freeze({ status: "BLOCKED", periodId: plan.periodId, reason: "CANONICAL_PAPER_ACCOUNT_UNAVAILABLE" });
    }
    if (account.updatedAt <= plan.periodStartAt) {
      return Object.freeze({ status: "WAITING_FOR_CANONICAL_BOUNDARY", periodId: plan.periodId });
    }
    if (tradingDayKey(account.updatedAt) === tradingDayKey(plan.periodStartAt)) {
      return Object.freeze({ status: "WAITING_FOR_KST_DAY_ROLLOVER", periodId: plan.periodId });
    }
    if (!hasRealizedFill(plan)) {
      return Object.freeze({ status: "WAITING_FOR_REALIZED_FILL", periodId: plan.periodId });
    }

    try {
      const closed = this.port.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: account.updatedAt });
      const realizedPeriods = Object.freeze([...this.port.listRealizedPeriods()]);
      if (!realizedPeriods.some((item) => item.record.recordId === closed.record.recordId)) {
        throw new Error("closed PAPER period is missing from the durable realized denominator");
      }
      const identity = this.port.buildEvidenceIdentity(Object.freeze({ closedPeriod: closed, realizedPeriods }));
      const cycle = this.port.runClosedLearningCycle(identity);

      if (cycle.record.decision.outcome !== "QUALIFIED_FOR_LEAGUE") {
        const periodIndex = nextPeriodIndex(realizedPeriods);
        this.port.openPeriodFromCanonicalAccount({
          periodId: `closed-learning-rollover:${periodIndex}:${account.updatedAt}`,
          periodIndex,
          advisory: plan.advisory,
          candidateProvenance: plan.candidateProvenance,
          ...(plan.market == null ? {} : { market: plan.market }),
          periodStartAt: account.updatedAt,
        });
      }

      return Object.freeze({ status: "CLOSED_AND_EVALUATED", periodId: plan.periodId, cycle });
    } catch (error) {
      return Object.freeze({
        status: "BLOCKED",
        periodId: plan.periodId,
        reason: error instanceof Error && error.message.trim() ? error.message : "CLOSED_LEARNING_ROLLOVER_FAILED",
      });
    }
  }
}
