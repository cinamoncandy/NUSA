import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { tradingDayKey } from "../../../packages/contracts/src/risk-safety-integration";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PaperRealizedPeriodOpenInput, PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { OWNER_BASELINE_CANDIDATE_ID } from "./ownerBaselinePaperStrategy";

export type ClosedLearningRolloverStatus =
  | "NO_OPEN_PERIOD"
  | "ACCOUNT_REPLACED_PERIOD_REOPENED"
  | "STALLED_PERIOD_REOPENED"
  | "UNSTREAMED_MARKET_PERIOD_RETIRED"
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
  /** Retires an open period whose canonical PAPER account was replaced (different initial capital). */
  readonly retireOpenPeriodForAccountChange?: (periodId: string) => PersistedPaperRealizedPeriodPlan;
  readonly retireOpenPeriodForReplacement?: (periodId: string, reason: string) => PersistedPaperRealizedPeriodPlan;
  /** Markets the runtime streams public tickers for; a period's benchmark can only come from one of these. */
  readonly streamedMarkets?: () => readonly string[];
  /** Retires an open period bound to a market that is no longer streamed (its benchmark can never exist). */
  readonly retireOpenPeriodForUnstreamedMarket?: (periodId: string, streamedMarkets: readonly string[]) => PersistedPaperRealizedPeriodPlan;
  /** A fresh owner-baseline period for the runtime's current market, built by the canonical owner-baseline builder. */
  readonly buildOwnerBaselinePeriod?: (input: { readonly periodIndex: number; readonly periodStartAt: number }) => PaperRealizedPeriodOpenInput | undefined;
  readonly buildEvidenceIdentity: (window: ClosedLearningEvidenceWindow) => ClosedLearningEvidenceIdentity;
  readonly runClosedLearningCycle: (identity: ClosedLearningEvidenceIdentity) => ClosedLearningCycleResult;
  readonly runClosedLearningCycleAsync?: (identity: ClosedLearningEvidenceIdentity) => Promise<ClosedLearningCycleResult>;
}

function nextPeriodIndex(periods: readonly PersistedPaperPeriodEnvelope[]): number {
  const maximum = periods.reduce((value, item) => Math.max(value, item.record.periodIndex), -1);
  if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) {
    throw new Error("closed-learning rollover period index is unavailable");
  }
  return maximum + 1;
}

/**
 * A blocked rollover reason leads with the failing step's stable error code (for example
 * "MISSING_BENCHMARK_EVIDENCE:<message>"), so the read-only loop status can say why it is blocked without
 * publishing free text. Errors without a code keep their message.
 */
function blockedReason(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message : "CLOSED_LEARNING_ROLLOVER_FAILED";
  const errorCode = (error as { readonly code?: unknown } | null)?.code;
  return typeof errorCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode) && !message.startsWith(`${errorCode}:`) ? `${errorCode}:${message}` : message;
}

function hasRealizedFill(plan: PersistedPaperRealizedPeriodPlan): boolean {
  return plan.observations.some((item) => item.status === "FILLED");
}

function stableOpenPeriods(input: readonly PersistedPaperRealizedPeriodPlan[]): readonly PersistedPaperRealizedPeriodPlan[] {
  return Object.freeze([...input].sort((left, right) => left.periodIndex - right.periodIndex || left.periodId.localeCompare(right.periodId)));
}

interface PreparedRollover {
  readonly plan: PersistedPaperRealizedPeriodPlan;
  readonly account: PaperAccountState;
  readonly realizedPeriods: readonly PersistedPaperPeriodEnvelope[];
  readonly identity: ClosedLearningEvidenceIdentity;
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

  /**
   * A period can be closed without a successor when the cycle throws after the close (the close
   * is durable, the successor open in finalize never runs). Realized history then also blocks the
   * owner-baseline bootstrap, so PAPER would stall forever with no open period. Continue the most
   * recent realized period's immutable candidate/advisory from the real canonical account boundary,
   * exactly as finalize would have. No fill, return or account value is synthesized.
   */
  private reopenStalledContinuation(): ClosedLearningRolloverResult {
    const realized = this.port.listRealizedPeriods();
    if (realized.length === 0) return Object.freeze({ status: "NO_OPEN_PERIOD" });
    const latest = [...realized].sort((left, right) => right.record.periodIndex - left.record.periodIndex || right.record.periodEndAt - left.record.periodEndAt)[0]!;
    const account = this.port.readCanonicalPaperAccount();
    if (account == null || account.version !== 1 || !Number.isSafeInteger(account.updatedAt) || account.updatedAt < 0) {
      return Object.freeze({ status: "BLOCKED", reason: "CANONICAL_PAPER_ACCOUNT_UNAVAILABLE" });
    }
    if (account.updatedAt <= latest.record.periodEndAt) {
      return Object.freeze({ status: "NO_OPEN_PERIOD", reason: "WAITING_FOR_CANONICAL_BOUNDARY" });
    }
    const periodIndex = nextPeriodIndex(realized);
    if (latest.record.market != null && this.isUnstreamed(latest.record.market)) {
      // The latest candidate was bound to a market this runtime no longer streams, so a continuation there could
      // never be benchmarked. Only the owner baseline may restart on the current market, through its canonical
      // builder (its provenance names the market); any other candidate stays blocked rather than being moved.
      const ownerBaseline = latest.candidateProvenance.length === 1 && latest.candidateProvenance[0]!.candidateId === OWNER_BASELINE_CANDIDATE_ID;
      const input = ownerBaseline ? this.port.buildOwnerBaselinePeriod?.({ periodIndex, periodStartAt: account.updatedAt }) : undefined;
      if (input == null || input.market == null || this.isUnstreamed(input.market)) return Object.freeze({ status: "BLOCKED", reason: "STALLED_PERIOD_MARKET_NOT_STREAMED" });
      const reopened = this.port.openPeriodFromCanonicalAccount(input);
      return Object.freeze({ status: "STALLED_PERIOD_REOPENED", periodId: reopened.periodId, reason: `continued:${latest.record.recordId}` });
    }
    const reopened = this.port.openPeriodFromCanonicalAccount({
      periodId: `closed-learning-rollover:${periodIndex}:${account.updatedAt}`,
      periodIndex,
      advisory: latest.record.advisory,
      candidateProvenance: latest.candidateProvenance,
      ...(latest.record.market == null ? {} : { market: latest.record.market }),
      periodStartAt: account.updatedAt,
    });
    return Object.freeze({ status: "STALLED_PERIOD_REOPENED", periodId: reopened.periodId, reason: `continued:${latest.record.recordId}` });
  }

  private isUnstreamed(market: string): boolean {
    const streamed = this.port.streamedMarkets?.();
    return streamed != null && streamed.length > 0 && !streamed.map((value) => value.trim().toUpperCase()).includes(market.trim().toUpperCase());
  }

  private prepare(): ClosedLearningRolloverResult | PreparedRollover {
    const periods = stableOpenPeriods(this.port.listOpenPeriods());
    if (periods.length === 0) return this.reopenStalledContinuation();
    if (periods.length > 1) return Object.freeze({ status: "BLOCKED", reason: "MULTIPLE_OPEN_PAPER_PERIODS" });

    const plan = periods[0]!;
    if (plan.market != null && this.isUnstreamed(plan.market)) {
      // Its benchmark can only come from that market's ticker store, which this runtime no longer feeds, so the
      // period can never close. Retire it (nothing is closed or scored); the next tick starts a fresh period.
      if (this.port.retireOpenPeriodForUnstreamedMarket == null) return Object.freeze({ status: "BLOCKED", periodId: plan.periodId, reason: "UNSTREAMED_MARKET_RETIREMENT_UNAVAILABLE" });
      this.port.retireOpenPeriodForUnstreamedMarket(plan.periodId, this.port.streamedMarkets?.() ?? []);
      return Object.freeze({ status: "UNSTREAMED_MARKET_PERIOD_RETIRED", periodId: plan.periodId, reason: "MARKET_NOT_STREAMED" });
    }
    const account = this.port.readCanonicalPaperAccount();
    if (account == null || account.version !== 1 || !Number.isSafeInteger(account.updatedAt) || account.updatedAt < 0) {
      return Object.freeze({ status: "BLOCKED", periodId: plan.periodId, reason: "CANONICAL_PAPER_ACCOUNT_UNAVAILABLE" });
    }
    if (plan.accountBoundary != null && plan.accountBoundary.initialCapital !== account.initialCapital) {
      // The owner replaced the PAPER account (different initial capital). The old period can never
      // reconcile against the new account, so retire it and continue the same candidate/advisory
      // in a fresh period opened from the new account.
      if (this.port.retireOpenPeriodForAccountChange == null) {
        return Object.freeze({ status: "BLOCKED", periodId: plan.periodId, reason: "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE" });
      }
      this.port.retireOpenPeriodForAccountChange(plan.periodId);
      const periodIndex = nextPeriodIndex(this.port.listRealizedPeriods());
      const reopened = this.port.openPeriodFromCanonicalAccount({
        periodId: `closed-learning-account-replaced:${periodIndex}:${account.updatedAt}`,
        periodIndex,
        advisory: plan.advisory,
        candidateProvenance: plan.candidateProvenance,
        ...(plan.market == null ? {} : { market: plan.market }),
        periodStartAt: account.updatedAt,
      });
      return Object.freeze({ status: "ACCOUNT_REPLACED_PERIOD_REOPENED", periodId: reopened.periodId, reason: `retired:${plan.periodId}` });
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

    const closed = this.port.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: account.updatedAt });
    const realizedPeriods = Object.freeze([...this.port.listRealizedPeriods()]);
    if (!realizedPeriods.some((item) => item.record.recordId === closed.record.recordId)) {
      throw new Error("closed PAPER period is missing from the durable realized denominator");
    }
    const identity = this.port.buildEvidenceIdentity(Object.freeze({ closedPeriod: closed, realizedPeriods }));
    return Object.freeze({ plan, account, realizedPeriods, identity });
  }

  private finalize(prepared: PreparedRollover, cycle: ClosedLearningCycleResult): ClosedLearningRolloverResult {
    // A qualified cycle deploys its replacement challenger and opens the next canonical PAPER
    // period through PaperChallengerDeploymentRuntime. Non-qualified outcomes retain the same
    // immutable candidate/advisory and continue accumulating evidence in a new canonical period.
    // So does a qualified cycle still waiting for Governance approval: without a deployment no
    // replacement period was opened, and PAPER must not stall with no open period.
    if (cycle.record.decision.outcome !== "QUALIFIED_FOR_LEAGUE" || cycle.record.paperDeployment == null) {
      const periodIndex = nextPeriodIndex(prepared.realizedPeriods);
      this.port.openPeriodFromCanonicalAccount({
        periodId: `closed-learning-rollover:${periodIndex}:${prepared.account.updatedAt}`,
        periodIndex,
        advisory: prepared.plan.advisory,
        candidateProvenance: prepared.plan.candidateProvenance,
        ...(prepared.plan.market == null ? {} : { market: prepared.plan.market }),
        periodStartAt: prepared.account.updatedAt,
      });
    }
    return Object.freeze({ status: "CLOSED_AND_EVALUATED", periodId: prepared.plan.periodId, cycle });
  }

  public runOnce(): ClosedLearningRolloverResult {
    let prepared: ClosedLearningRolloverResult | PreparedRollover | undefined;
    try {
      prepared = this.prepare();
      if ("status" in prepared) return prepared;
      return this.finalize(prepared, this.port.runClosedLearningCycle(prepared.identity));
    } catch (error) {
      const periodId = prepared != null && !("status" in prepared) ? prepared.plan.periodId : undefined;
      return Object.freeze({
        status: "BLOCKED",
        ...(periodId == null ? {} : { periodId }),
        reason: blockedReason(error),
      });
    }
  }

  /** Async production path yields while Research/League evaluates the closed PAPER evidence. */
  public async runOnceAsync(): Promise<ClosedLearningRolloverResult> {
    let prepared: ClosedLearningRolloverResult | PreparedRollover | undefined;
    try {
      prepared = this.prepare();
      if ("status" in prepared) return prepared;
      const cycle = this.port.runClosedLearningCycleAsync == null
        ? this.port.runClosedLearningCycle(prepared.identity)
        : await this.port.runClosedLearningCycleAsync(prepared.identity);
      return this.finalize(prepared, cycle);
    } catch (error) {
      const periodId = prepared != null && !("status" in prepared) ? prepared.plan.periodId : undefined;
      return Object.freeze({
        status: "BLOCKED",
        ...(periodId == null ? {} : { periodId }),
        reason: blockedReason(error),
      });
    }
  }
}
