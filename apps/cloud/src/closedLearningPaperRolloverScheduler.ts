import type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import type { PaperRealizedPeriodOpenInput, PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";

export interface ClosedLearningCycleRunner {
  runOnce(): unknown;
}

export interface ClosedLearningPendingPeriodRow {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly periodStartAt: number;
  readonly payloadJson: string;
}

export interface ClosedLearningPaperRolloverSchedulerOptions {
  readonly listPendingPeriods: () => readonly ClosedLearningPendingPeriodRow[];
  readonly listRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly closePeriodFromCanonicalAccount: (input: { readonly periodId: string; readonly periodEndAt: number }) => PersistedPaperPeriodEnvelope;
  readonly openPeriodFromCanonicalAccount: (input: PaperRealizedPeriodOpenInput) => PersistedPaperRealizedPeriodPlan;
  readonly readCanonicalPaperAccount: () => PaperAccountState;
  readonly bindings: Pick<PaperChallengerBindingLedger, "current">;
  readonly cycle: ClosedLearningCycleRunner;
  readonly evidenceWindowMs?: number;
  readonly intervalMs?: number;
  readonly onError?: (error: Error) => void;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

interface PendingPlanProjection {
  readonly schemaVersion: 1;
  readonly periodId: string;
  readonly periodIndex: number;
  readonly market: string;
  readonly periodStartAt: number;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
}

export const DEFAULT_CLOSED_LEARNING_EVIDENCE_WINDOW_MS = 86_400_000;
export const DEFAULT_CLOSED_LEARNING_ROLLOVER_INTERVAL_MS = 60_000;
const MARKET = /^KRW-[A-Z0-9-]+$/;

function safeTime(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} is invalid`);
  return Number(value);
}

function parsePending(row: ClosedLearningPendingPeriodRow): PendingPlanProjection {
  let parsed: unknown;
  try { parsed = JSON.parse(row.payloadJson); } catch { throw new Error("closed learning pending PAPER period is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("closed learning pending PAPER period is invalid");
  const value = parsed as Record<string, unknown>;
  const periodId = typeof value.periodId === "string" ? value.periodId.trim() : "";
  const market = typeof value.market === "string" ? value.market.trim().toUpperCase() : "";
  const periodIndex = safeTime(value.periodIndex, "periodIndex");
  const periodStartAt = safeTime(value.periodStartAt, "periodStartAt");
  if (value.schemaVersion !== 1 || !periodId || !MARKET.test(market) || periodId !== row.periodId || periodIndex !== row.periodIndex || periodStartAt !== row.periodStartAt) {
    throw new Error("closed learning pending PAPER period identity conflict");
  }
  if (value.advisory == null || typeof value.advisory !== "object" || !Array.isArray(value.candidateProvenance) || value.candidateProvenance.length !== 1) {
    throw new Error("closed learning pending PAPER period provenance is incomplete");
  }
  const candidateProvenance = (value.candidateProvenance as PersistedPaperCandidateProvenance[]).map((item) => Object.freeze({ ...item }));
  if (!candidateProvenance[0]?.candidateId?.trim() || !candidateProvenance[0]?.datasetId?.trim() || !/^[a-f0-9]{64}$/.test(candidateProvenance[0]?.datasetContentSha256 ?? "")) {
    throw new Error("closed learning pending PAPER candidate provenance is invalid");
  }
  return Object.freeze({ schemaVersion: 1, periodId, periodIndex, market, periodStartAt, advisory: value.advisory as LeagueCapitalAllocationAdvisory, candidateProvenance: Object.freeze(candidateProvenance) });
}

function nextPeriodIndex(periods: readonly PersistedPaperPeriodEnvelope[]): number {
  const maximum = periods.reduce((value, item) => Math.max(value, item.record.periodIndex), -1);
  if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) throw new Error("closed learning next PAPER period index is unavailable");
  return maximum + 1;
}

/**
 * Serial, fail-closed evidence-window rollover for the canonical PAPER runtime.
 * It never places orders, changes trading thresholds, or creates LIVE authority. It only closes
 * an already-open canonical PAPER evidence period once the canonical account clock crosses the
 * configured window, invokes the replay-safe closed-learning cycle, and ensures evidence
 * collection continues for the still-active PAPER challenger when no replacement was deployed.
 */
export class ClosedLearningPaperRolloverScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly evidenceWindowMs: number;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  public constructor(private readonly options: ClosedLearningPaperRolloverSchedulerOptions) {
    this.evidenceWindowMs = options.evidenceWindowMs ?? DEFAULT_CLOSED_LEARNING_EVIDENCE_WINDOW_MS;
    this.intervalMs = options.intervalMs ?? DEFAULT_CLOSED_LEARNING_ROLLOVER_INTERVAL_MS;
    if (!Number.isSafeInteger(this.evidenceWindowMs) || this.evidenceWindowMs < 60_000 || this.evidenceWindowMs > 31 * 86_400_000) throw new Error("closed learning evidence window is invalid");
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1_000 || this.intervalMs > 86_400_000) throw new Error("closed learning rollover interval is invalid");
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  private recoverOrContinue(account: PaperAccountState, basis?: PersistedPaperPeriodEnvelope): void {
    if (this.options.listPendingPeriods().length > 0) return;
    this.options.cycle.runOnce();
    if (this.options.listPendingPeriods().length > 0) return;

    const periods = this.options.listRealizedPeriods();
    const latest = basis ?? [...periods].sort((left, right) => right.record.periodEndAt - left.record.periodEndAt || right.record.periodIndex - left.record.periodIndex)[0];
    if (latest == null || latest.record.market == null || latest.candidateProvenance.length !== 1) return;
    const active = this.options.bindings.current(latest.record.market, account.updatedAt);
    if (active == null || active.binding.candidateId !== latest.candidateProvenance[0]!.candidateId) return;
    if (active.binding.datasetId !== latest.candidateProvenance[0]!.datasetId || active.binding.datasetContentSha256 !== latest.candidateProvenance[0]!.datasetContentSha256) {
      throw new Error("closed learning rollover active binding provenance conflict");
    }
    const periodIndex = nextPeriodIndex(periods);
    const periodId = `paper-rollover:${active.binding.bindingFingerprintSha256}:${periodIndex}`;
    this.options.openPeriodFromCanonicalAccount({
      periodId,
      periodIndex,
      advisory: latest.record.advisory,
      candidateProvenance: latest.candidateProvenance,
      market: latest.record.market,
      periodStartAt: account.updatedAt,
    });
  }

  public runOnce(): PersistedPaperPeriodEnvelope | undefined {
    if (this.running) return undefined;
    this.running = true;
    try {
      const account = this.options.readCanonicalPaperAccount();
      if (account == null || account.version !== 1 || !Number.isSafeInteger(account.updatedAt) || account.updatedAt < 0) throw new Error("closed learning canonical PAPER account is unavailable");
      const pending = this.options.listPendingPeriods();
      if (pending.length > 1) throw new Error("closed learning multiple open PAPER periods are unsafe");
      if (pending.length === 0) {
        this.recoverOrContinue(account);
        return undefined;
      }
      const plan = parsePending(pending[0]!);
      if (account.updatedAt - plan.periodStartAt < this.evidenceWindowMs) return undefined;
      const closed = this.options.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: account.updatedAt });
      this.recoverOrContinue(account, closed);
      return closed;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("closed learning PAPER rollover failed");
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
