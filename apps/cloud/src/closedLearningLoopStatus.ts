import type { ClosedLearningInitialPaperBootstrapResult } from "./closedLearningInitialPaperBootstrap";
import type { ClosedLearningRolloverResult } from "./closedLearningRolloverScheduler";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { ClosedLearningCycleRecord } from "./closedLearningLoopCoordinator";

/**
 * Display-only status of the production closed-learning loop (bootstrap -> PAPER period -> rollover -> Research
 * decision -> next PAPER deployment). It was only logged, so the step where Experience N -> Research N+1 stalls was
 * not observable. Steps are fixed codes and integers; `evidence` adds only canonical identifiers, fingerprints and
 * markets. No amounts, prices, returns or free text.
 */
export type ClosedLearningLoopStatus = {
  readonly lastTickAt: number;
  readonly ticks: number;
  readonly bootstrap: string;
  readonly rollover: string;
  readonly rolloverReason?: string;
  readonly cyclesEvaluated: number;
  readonly lastCycleStatus?: string;
  readonly lastCycleOutcome?: string;
  readonly deployments: number;
  /**
   * Correlation identities read from the canonical components (open PAPER period, latest realized period, latest
   * closed-learning cycle), so period -> fill -> realized outcome -> evidence -> Research decision -> next candidate
   * can be followed mechanically. Identifiers and fingerprints only; no amounts, prices, returns or free text.
   */
  readonly evidence?: ClosedLearningEvidenceCorrelation;
};

export type ClosedLearningEvidenceCorrelation = Readonly<Partial<{
  openPeriodId: string; openMarket: string; openCandidateId: string; openPeriodStartAt: number; openObservations: number; openFilledObservations: number;
  realizedPeriods: number; realizedPeriodId: string; realizedPeriodEndAt: number; realizedOutcomeFingerprint: string; realizedCostEvidenceFingerprint: string;
  cycleId: string; cycleEvidenceId: string; cycleEvidenceFingerprint: string; decisionId: string; decisionReference: string; decisionCandidateId: string; deploymentId: string;
  /** Durable (survives restarts): how many cycles the ledger holds, and when the latest was recorded. */
  cyclesRecorded: number; lastCycleRecordedAt: number;
}>>;

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const code = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const head = value.split(":")[0]!;
  return CODE.test(head) ? head : undefined;
};

export class ClosedLearningLoopStatusTracker {
  private status: ClosedLearningLoopStatus | null = null;
  private bootstrap = "NOT_RUN";
  private periods: ClosedLearningEvidenceCorrelation = {};
  private cycle: ClosedLearningEvidenceCorrelation = {};
  private durable: { cyclesRecorded: number; lastCycleRecordedAt?: number } | null = null;
  private durableOutcome: string | undefined;
  private durableCycleIdentity: ClosedLearningEvidenceCorrelation = {};

  /** Reads the identities of the current open period and the latest realized period. */
  public observePeriods(open: PersistedPaperRealizedPeriodPlan | undefined, realized: readonly PersistedPaperPeriodEnvelope[]): void {
    const latest = [...realized].sort((left, right) => right.record.periodIndex - left.record.periodIndex || right.record.periodEndAt - left.record.periodEndAt)[0];
    this.periods = Object.freeze({
      ...(open == null ? {} : {
        openPeriodId: open.periodId,
        ...(open.market == null ? {} : { openMarket: open.market }),
        ...(open.candidateProvenance[0] == null ? {} : { openCandidateId: open.candidateProvenance[0].candidateId }),
        openPeriodStartAt: open.periodStartAt,
        openObservations: open.observations.length,
        openFilledObservations: open.observations.filter((item) => item.status === "FILLED").length,
      }),
      realizedPeriods: realized.length,
      ...(latest == null ? {} : {
        realizedPeriodId: latest.record.recordId,
        realizedPeriodEndAt: latest.record.periodEndAt,
        ...(latest.record.canonicalOutcomeReceiptFingerprint == null ? {} : { realizedOutcomeFingerprint: latest.record.canonicalOutcomeReceiptFingerprint }),
        realizedCostEvidenceFingerprint: latest.record.costEvidence.evidenceFingerprintSha256,
      }),
    });
    this.publish();
  }

  /**
   * Seeds the cycle identities from the durable ledger so a restart does not erase the evidence of the last lap. The counters
   * (cyclesEvaluated, lastCycle*) stay per process; what a cycle in this process observed always wins over the durable copy.
   */
  public observeDurableCycles(summary: { readonly cyclesRecorded: number; readonly latest?: ClosedLearningCycleRecord }): void {
    this.durable = Object.freeze({ cyclesRecorded: summary.cyclesRecorded, ...(summary.latest == null ? {} : { lastCycleRecordedAt: summary.latest.recordedAt }) });
    const latest = summary.latest;
    this.durableOutcome = code(latest?.decision?.outcome);
    this.durableCycleIdentity = latest == null ? {} : Object.freeze(Object.fromEntries(Object.entries({
      cycleId: latest.cycleId,
      cycleEvidenceId: latest.evidenceId,
      cycleEvidenceFingerprint: latest.evidenceFingerprintSha256,
      decisionId: latest.decision?.decisionId,
      decisionReference: latest.decision?.decisionReference,
      decisionCandidateId: latest.decision?.candidateId,
      deploymentId: latest.paperDeployment?.deploymentId,
    }).filter(([, value]) => typeof value === "string" && value.length > 0)));
    this.publish();
  }

  private publish(): void {
    if (this.status == null) return;
    const evidence = Object.freeze({
      ...this.durableCycleIdentity,
      ...(this.durable == null ? {} : { cyclesRecorded: this.durable.cyclesRecorded, ...(this.durable.lastCycleRecordedAt === undefined || !Number.isSafeInteger(this.durable.lastCycleRecordedAt) ? {} : { lastCycleRecordedAt: this.durable.lastCycleRecordedAt }) }),
      ...this.periods,
      ...this.cycle,
    });
    this.status = Object.freeze({
      ...this.status,
      ...(this.status.lastCycleOutcome === undefined && this.durableOutcome !== undefined ? { lastCycleOutcome: this.durableOutcome } : {}),
      ...(Object.keys(evidence).length === 0 ? {} : { evidence }),
    });
  }

  public observeBootstrap(result: Pick<ClosedLearningInitialPaperBootstrapResult, "status">): void {
    this.bootstrap = code(result.status) ?? "UNKNOWN";
  }

  public observeRollover(result: Pick<ClosedLearningRolloverResult, "status" | "reason" | "cycle">, now: number): void {
    const previous = this.status;
    const evaluated = result.status === "CLOSED_AND_EVALUATED";
    const cycleStatus = code(result.cycle?.status);
    const cycleOutcome = code(result.cycle?.record?.decision?.outcome);
    const deployed = evaluated && result.cycle?.record?.paperDeployment != null;
    const reason = code(result.reason);
    this.status = Object.freeze({
      lastTickAt: now,
      ticks: (previous?.ticks ?? 0) + 1,
      bootstrap: this.bootstrap,
      rollover: code(result.status) ?? "UNKNOWN",
      ...(reason === undefined ? {} : { rolloverReason: reason }),
      cyclesEvaluated: (previous?.cyclesEvaluated ?? 0) + (evaluated ? 1 : 0),
      ...(cycleStatus === undefined ? (previous?.lastCycleStatus === undefined ? {} : { lastCycleStatus: previous.lastCycleStatus }) : { lastCycleStatus: cycleStatus }),
      ...(cycleOutcome === undefined ? (previous?.lastCycleOutcome === undefined ? {} : { lastCycleOutcome: previous.lastCycleOutcome }) : { lastCycleOutcome: cycleOutcome }),
      deployments: (previous?.deployments ?? 0) + (deployed ? 1 : 0),
    });
    const record = result.cycle?.record;
    if (record != null) {
      const entries = Object.entries({
        cycleId: record.cycleId,
        cycleEvidenceId: record.evidenceId,
        cycleEvidenceFingerprint: record.evidenceFingerprintSha256,
        decisionId: record.decision?.decisionId,
        decisionReference: record.decision?.decisionReference,
        decisionCandidateId: record.decision?.candidateId,
        deploymentId: record.paperDeployment?.deploymentId,
      }).filter(([, value]) => typeof value === "string" && value.length > 0);
      this.cycle = Object.freeze(Object.fromEntries(entries));
    }
    this.publish();
  }

  /** A tick that threw before a rollover result: recorded as ERROR without changing the counts. */
  public observeError(now: number): void {
    const previous = this.status;
    this.status = Object.freeze({ ...(previous ?? { cyclesEvaluated: 0, deployments: 0 }), lastTickAt: now, ticks: (previous?.ticks ?? 0) + 1, bootstrap: this.bootstrap, rollover: "ERROR" }) as ClosedLearningLoopStatus;
  }

  public snapshot(): ClosedLearningLoopStatus | null {
    return this.status;
  }
}
