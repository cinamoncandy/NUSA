import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PersistedPaperPendingPeriod } from "../../../packages/storage/src/persistedPaperPeriodStore";
import type { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperClosedLearningEvidenceSource } from "./paperClosedLearningEvidenceSource";
import type { ClosedLearningCycleResult, ClosedLearningLoopCoordinator } from "./closedLearningLoopCoordinator";
import type { QualifiedPaperChallengerArtifactReader } from "./paperChallengerDeploymentRuntime";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";
import { PaperRealizedPeriodProducerError, type PaperRealizedPeriodCanonicalCloseInput, type PaperRealizedPeriodOpenInput, type PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

export const DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS = 86_400_000;
export const DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS = 60_000;

export interface ClosedLearningPaperPeriodLifecyclePort {
  readonly listOpenPeriods: () => readonly PersistedPaperPendingPeriod[];
  readonly listRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly closePeriodFromCanonicalAccount: (input: PaperRealizedPeriodCanonicalCloseInput) => PersistedPaperPeriodEnvelope;
  readonly openPeriodFromCanonicalAccount: (input: PaperRealizedPeriodOpenInput) => PersistedPaperRealizedPeriodPlan;
}

export interface ClosedLearningPaperPeriodLifecycleResult {
  readonly status: "WAITING_FOR_WINDOW" | "WAITING_FOR_EVIDENCE" | "CYCLED";
  readonly closedPeriodId?: string;
  readonly rolloverPeriodId?: string;
  readonly cycle?: ClosedLearningCycleResult;
}

export interface ClosedLearningPaperPeriodLifecycleSchedulerOptions {
  readonly periods: ClosedLearningPaperPeriodLifecyclePort;
  readonly bindings: Pick<PaperChallengerBindingLedger, "current">;
  readonly artifacts: QualifiedPaperChallengerArtifactReader;
  readonly coordinator: Pick<ClosedLearningLoopCoordinator, "run">;
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly sourceCommitSha: string;
  readonly costModelVersion: string;
  readonly riskConfigHash: string;
  readonly periodWindowMs?: number;
  readonly intervalMs?: number;
  readonly onResult?: (result: ClosedLearningPaperPeriodLifecycleResult) => void;
  readonly onError?: (error: Error) => void;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const RETRYABLE_CLOSE_CODES = new Set(["PERIOD_OUTCOME_NOT_OBSERVED", "CANDIDATE_ATTRIBUTION_UNAVAILABLE", "MISSING_BENCHMARK_EVIDENCE", "BENCHMARK_EVIDENCE_UNAVAILABLE"]);

function marketOf(period: PersistedPaperPeriodEnvelope): string {
  const market = period.record.market?.trim().toUpperCase() ?? "";
  if (!MARKET.test(market)) throw new Error("closed learning PAPER period market is invalid");
  return market;
}

function safeAccount(input: PaperAccountState | undefined): PaperAccountState | undefined {
  if (input == null) return undefined;
  if (input.version !== 1 || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) throw new Error("closed learning canonical PAPER account boundary is invalid");
  return input;
}

function nextPeriodIndex(periods: readonly PersistedPaperPeriodEnvelope[]): number {
  const maximum = periods.reduce((value, item) => Math.max(value, item.record.periodIndex), -1);
  if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) throw new Error("closed learning PAPER period index is unavailable");
  return maximum + 1;
}

function lineageAt(period: PersistedPaperPeriodEnvelope, bindings: Pick<PaperChallengerBindingLedger, "current">): PaperResearchLineage {
  const activation = bindings.current(marketOf(period), period.record.periodStartAt);
  if (activation?.researchLineage == null) throw new Error("closed learning PAPER period Research lineage is unavailable");
  return validatePaperResearchLineage(activation.researchLineage);
}

function contiguousLineageCohort(
  target: PersistedPaperPeriodEnvelope,
  realized: readonly PersistedPaperPeriodEnvelope[],
  bindings: Pick<PaperChallengerBindingLedger, "current">,
): readonly PersistedPaperPeriodEnvelope[] {
  const ordered = [...realized].sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.recordId.localeCompare(right.record.recordId));
  const targetIndex = ordered.findIndex((item) => item.record.recordId === target.record.recordId);
  if (targetIndex < 0) throw new Error("closed learning target PAPER period is unavailable");
  const targetMarket = marketOf(target);
  const targetLineage = lineageAt(target, bindings);
  const selected: PersistedPaperPeriodEnvelope[] = [];
  for (let index = targetIndex; index >= 0; index -= 1) {
    const period = ordered[index]!;
    if (marketOf(period) !== targetMarket) break;
    const lineage = lineageAt(period, bindings);
    if (!samePaperResearchLineage(lineage, targetLineage)) break;
    selected.unshift(period);
  }
  if (selected.length === 0) throw new Error("closed learning PAPER lineage cohort is unavailable");
  return Object.freeze(selected);
}

/**
 * Production lifecycle around the existing realized-period producer and closed-learning coordinator.
 * It never manufactures returns, signals, Research scores or candidate rankings. A period is closed
 * only on the exact canonical PAPER account boundary after the configured elapsed window, and only
 * the contiguous immutable Research-lineage cohort is replayed. If Research remains insufficient or
 * fails, the active PAPER challenger is rolled into a new canonical period so longitudinal evidence
 * can continue accumulating without the app or a human order.
 */
export class ClosedLearningPaperPeriodLifecycleScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly periodWindowMs: number;
  private readonly intervalMs: number;
  private readonly sourceCommitSha: string;
  private readonly costModelVersion: string;
  private readonly riskConfigHash: string;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  public constructor(private readonly options: ClosedLearningPaperPeriodLifecycleSchedulerOptions) {
    this.periodWindowMs = options.periodWindowMs ?? DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS;
    this.intervalMs = options.intervalMs ?? DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS;
    if (!Number.isSafeInteger(this.periodWindowMs) || this.periodWindowMs < 60_000 || this.periodWindowMs > 2_592_000_000) throw new Error("closed learning PAPER period window is invalid");
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1_000 || this.intervalMs > 86_400_000 || this.intervalMs > this.periodWindowMs) throw new Error("closed learning PAPER lifecycle interval is invalid");
    this.sourceCommitSha = options.sourceCommitSha.trim().toLowerCase();
    this.costModelVersion = options.costModelVersion.trim();
    this.riskConfigHash = options.riskConfigHash.trim().toLowerCase();
    if (!SHA40.test(this.sourceCommitSha) || !this.costModelVersion || !SHA256.test(this.riskConfigHash)) throw new Error("closed learning PAPER lifecycle provenance is invalid");
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  private evidenceIdentity(target: PersistedPaperPeriodEnvelope) {
    const realized = this.options.periods.listRealizedPeriods();
    const cohort = contiguousLineageCohort(target, realized, this.options.bindings);
    const lineage = lineageAt(target, this.options.bindings);
    const evidence = new PaperClosedLearningEvidenceSource({
      listPaperRealizedPeriods: () => cohort,
      champion: () => Object.freeze({ championId: lineage.candidateId, championVersion: lineage.candidateVersion }),
      sourceCommitSha: this.sourceCommitSha,
      costModelVersion: this.costModelVersion,
      riskConfigHash: this.riskConfigHash,
      minimumPeriods: 1,
    }).read();
    if (evidence == null) throw new Error("closed learning PAPER evidence identity is unavailable");
    return evidence;
  }

  private openNextPeriodForActiveBinding(marketValue: string): PersistedPaperRealizedPeriodPlan | undefined {
    if (this.options.periods.listOpenPeriods().length > 0) return undefined;
    const account = safeAccount(this.options.readCanonicalPaperAccount());
    if (account == null) return undefined;
    const market = marketValue.trim().toUpperCase();
    if (!MARKET.test(market)) throw new Error("closed learning PAPER rollover market is invalid");
    const active = this.options.bindings.current(market, account.updatedAt);
    if (active == null) return undefined;
    if (active.researchLineage == null) throw new Error("closed learning active PAPER Research lineage is unavailable");
    const lineage = validatePaperResearchLineage(active.researchLineage);
    const artifact = this.options.artifacts.read(lineage.candidateId, lineage.candidateVersion);
    if (artifact == null || artifact.researchLineage == null) throw new Error("closed learning active PAPER artifact is unavailable");
    if (artifact.market.trim().toUpperCase() !== market || !samePaperResearchLineage(validatePaperResearchLineage(artifact.researchLineage), lineage)) throw new Error("closed learning active PAPER artifact lineage conflict");
    const provenance = artifact.candidateProvenance.filter((item) => item.candidateId === active.binding.candidateId);
    if (provenance.length !== 1 || provenance[0]!.datasetId !== active.binding.datasetId || provenance[0]!.datasetContentSha256 !== active.binding.datasetContentSha256) throw new Error("closed learning active PAPER artifact dataset conflict");
    const periodIndex = nextPeriodIndex(this.options.periods.listRealizedPeriods());
    return this.options.periods.openPeriodFromCanonicalAccount({
      periodId: `paper-rollover:${active.binding.bindingFingerprintSha256}:${periodIndex}:${account.updatedAt}`,
      periodIndex,
      advisory: artifact.advisory,
      candidateProvenance: artifact.candidateProvenance,
      market,
      periodStartAt: account.updatedAt,
    });
  }

  private executeOnce(): ClosedLearningPaperPeriodLifecycleResult | undefined {
    const account = safeAccount(this.options.readCanonicalPaperAccount());
    if (account == null) return undefined;
    const open = this.options.periods.listOpenPeriods();
    if (open.length > 1) throw new Error("multiple canonical PAPER periods are open");

    let target: PersistedPaperPeriodEnvelope | undefined;
    let closedPeriodId: string | undefined;
    if (open.length === 1) {
      const pending = open[0]!;
      if (account.updatedAt < pending.periodStartAt) throw new Error("closed learning PAPER account clock regressed behind the open period");
      if (account.updatedAt - pending.periodStartAt < this.periodWindowMs) return Object.freeze({ status: "WAITING_FOR_WINDOW" });
      try {
        target = this.options.periods.closePeriodFromCanonicalAccount({ periodId: pending.periodId, periodEndAt: account.updatedAt });
        closedPeriodId = target.record.recordId;
      } catch (error) {
        if (error instanceof PaperRealizedPeriodProducerError && RETRYABLE_CLOSE_CODES.has(error.code)) return Object.freeze({ status: "WAITING_FOR_EVIDENCE" });
        throw error;
      }
    } else {
      const realized = this.options.periods.listRealizedPeriods();
      target = realized.at(-1);
      if (target == null) return undefined;
    }

    const targetMarket = marketOf(target);
    let cycle: ClosedLearningCycleResult;
    try {
      cycle = this.options.coordinator.run(this.evidenceIdentity(target));
    } catch (error) {
      try { this.openNextPeriodForActiveBinding(targetMarket); } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], "closed learning cycle failed and PAPER rollover recovery failed");
      }
      throw error;
    }

    const rollover = this.openNextPeriodForActiveBinding(targetMarket);
    return Object.freeze({
      status: "CYCLED",
      ...(closedPeriodId == null ? {} : { closedPeriodId }),
      ...(rollover == null ? {} : { rolloverPeriodId: rollover.periodId }),
      cycle,
    });
  }

  public runOnce(): ClosedLearningPaperPeriodLifecycleResult | undefined {
    if (this.running) return undefined;
    this.running = true;
    try {
      const result = this.executeOnce();
      if (result != null) this.options.onResult?.(result);
      return result;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("closed learning PAPER lifecycle failed");
      this.options.onError?.(normalized);
      return undefined;
    } finally {
      this.running = false;
    }
  }

  public start(): void {
    if (this.timer != null) return;
    this.runOnce();
    this.timer = this.setIntervalFn(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer == null) return;
    this.clearIntervalFn(this.timer);
    this.timer = undefined;
  }
}
