import { composeResearchExperiments } from "./researchExperimentComposition";
import { PaperChallengerPolicyApproval, paperChallengerPolicyEnabled } from "./paperChallengerPolicyApproval";
import type { CommitteeVote, StrategyIdentity, StrategyValidationSummary } from "../../../packages/contracts/src/strategyGovernance";
import { adaptPersistedPaperForwardEvidence } from "../../desktop/src/cloud/persistedPaperForwardEvidenceAdapter";
import { buildCanonicalPaperCandidatePerformance } from "./canonicalPaperCandidatePerformance";
import { evaluatePaperPerformanceGovernanceFeedback, type PaperPerformanceGovernanceFeedbackReceipt } from "./paperPerformanceGovernanceFeedback";
import { SqliteDatabase, SqliteEvolutionLearningLedger, SqlitePaperMarketObservationRepository } from "../../../packages/storage/src/index";
import { PaperMinuteBarSource } from "./paperMinuteBars";
import { ClosedLearningLoopStatusTracker } from "./closedLearningLoopStatus";
import { FileResearchRunReplaySnapshotStore } from "../../desktop/src/cloud/researchRunReplaySnapshotStore";
import { readCloudRuntimeConfig } from "./cloudRuntimeConfig";
import { readClosedLearningBlocked, recordClosedLearningBlocked } from "./closedLearningBlockedRecord";
import { PaperBaselineShadow } from "./paperBaselineShadow";
import { readBaselineShadowRecord, writeBaselineShadowRecord } from "./paperBaselineShadowRecord";
import { recordRuntimeFailure } from "./runtimeFailureRecord";
import { ResearchSnapshotRefresher } from "./researchSnapshotRefresher";
import { retiredPaperAccountIds, retirePaperAccounts } from "./paperAccountRetirement";
import { OwnerBaselinePaperBindingProvider, isOwnerBaselineSourceCommitSha, ownerBaselineStrategyEnabled, ownerBaselineStrategySpec } from "./ownerBaselinePaperStrategy";
import { buildOwnerBaselinePaperPeriodInput, isOwnerBaselinePeriodStartAt } from "./ownerBaselinePaperPeriod";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { SqliteCloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, paperAccountIdForCapital, type PaperAccountState } from "./paperTradingExecutionLoop";
import { createCloudAiRuntime } from "./ai/runtime";
import { registerGracefulShutdown, startCloudRuntime, type CloudRuntimeHandle } from "./runtime";
import { readClosedLearningProductionConfig } from "./closedLearningProductionConfig";
import { ClosedLearningResearchWorkerClient } from "./closedLearningResearchWorkerClient";
import { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";
import { FileQualifiedPaperChallengerArtifactStore } from "./qualifiedPaperChallengerArtifactStore";
import { ClosedLearningLineageReplayInputSource } from "./closedLearningLineageReplayInputSource";
import { ClosedLearningProductionResearchAdapter } from "./closedLearningProductionResearchAdapter";
import { ClosedLearningEvolutionLedgerRepository } from "./closedLearningEvolutionLedgerRepository";
import { ClosedLearningLoopCoordinator, type ClosedLearningCycleResult, type ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { PaperChallengerDeploymentRuntime } from "./paperChallengerDeploymentRuntime";
import { ClosedLearningPendingPeriodReader } from "./closedLearningPendingPeriodReader";
import { ClosedLearningEvidenceIdentitySource } from "./closedLearningEvidenceIdentitySource";
import { CLOUD_PAPER_RISK_POLICY_FINGERPRINT } from "./cloudPaperRiskPolicyIdentity";
import { ClosedLearningRolloverScheduler, type ClosedLearningRolloverResult } from "./closedLearningRolloverScheduler";
import { ClosedLearningInitialPaperBootstrap, type ClosedLearningInitialPaperBootstrapResult } from "./closedLearningInitialPaperBootstrap";
import { buildPaperPerformanceFromLedger, type PaperPerformanceFromLedgerResult } from "./paperPerformanceFromLedger";

export const CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS = 30_000;

export interface ClosedLearningProductionComposition {
  readonly handle: CloudRuntimeHandle;
  readonly challengerBindings: PaperChallengerBindingLedger;
  /**
   * Read-only view of the exact canonical PAPER loop owned by this production process.
   * Closed-learning evidence consumers use this instead of opening a second account repository
   * or acquiring a competing writer lease.
   */
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  /** Executes one replay-safe closed-learning cycle over an explicit immutable evidence identity. */
  readonly runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => ClosedLearningCycleResult;
  readonly runClosedLearningCycleAsync: (input: ClosedLearningEvidenceIdentity) => Promise<ClosedLearningCycleResult>;
  /** Attempts initial canonical Research→PAPER deployment when no PAPER period has ever existed. */
  readonly runClosedLearningBootstrap: () => ClosedLearningInitialPaperBootstrapResult;
  readonly runClosedLearningBootstrapAsync: () => Promise<ClosedLearningInitialPaperBootstrapResult>;
  /** Executes one production rollover decision against the canonical pending/realized ledgers. */
  readonly runClosedLearningRollover: () => ClosedLearningRolloverResult;
  readonly runClosedLearningRolloverAsync: () => Promise<ClosedLearningRolloverResult>;
  /** Read-only deterministic Performance Evidence from this process' canonical PAPER history. */
  readonly readPaperPerformanceEvidence: (periodId: string) => PaperPerformanceFromLedgerResult;
}

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 *
 * One process owns the canonical SQLite database, PAPER account loop, realized-period producer,
 * Research replay worker boundary, complete denominator history, immutable challenger artifacts,
 * replay-safe cycle ledger, initial PAPER bootstrap, and next-PAPER deployment. No second PAPER
 * writer, Research scoring engine, LIVE route, or production champion mutation is introduced here.
 */
export function startClosedLearningProductionRuntime(env: NodeJS.ProcessEnv = process.env): ClosedLearningProductionComposition {
  const config = readCloudRuntimeConfig(env);
  const closedLearningConfig = readClosedLearningProductionConfig(env, config.cloudStateDbPath);
  const database = new SqliteDatabase(config.cloudStateDbPath);
  if (config.paperInitialCapitalKrw !== undefined) {
    const retired = retiredPaperAccountIds(env);
    if (retired.length > 0) {
      const receipts = retirePaperAccounts(database, retired, paperAccountIdForCapital(config.paperInitialCapitalKrw), { stateDbPath: config.cloudStateDbPath });
      for (const receipt of receipts) console.log(`[paper-account] retired ${receipt.accountId}: ${JSON.stringify(receipt.deletedRows)}`);
    }
  }
  const snapshots = new SqliteCloudDashboardSnapshotRepository(database);
  const learningLedger = new SqliteEvolutionLearningLedger(database);
  const challengerBindings = new PaperChallengerBindingLedger(learningLedger);
  // A qualified challenger always wins; until one exists the owner-approved PAPER baseline trades.
  const paperCandidateBindingProvider = new OwnerBaselinePaperBindingProvider({
    challenger: challengerBindings,
    sourceCommitSha: env.NUSA_SOURCE_COMMIT_SHA ?? env.NUSA_SOURCE_COMMIT ?? "",
    enabled: ownerBaselineStrategyEnabled(env),
    baselineMarkets: config.upbitMarkets,
  });
  // The candidate strategy reads completed 1-minute closes from the persisted public-ticker store (owner decision 2026-10-06).
  const minuteObservationReader = new SqlitePaperMarketObservationRepository(database);
  const minuteBars = new PaperMinuteBarSource((market, startAt, endAt) => minuteObservationReader.readWindow(market, startAt, endAt));
  // Uncensored shadow of the baseline rule on the same completed minute bars (display/analysis only; no order, ledger or Risk input).
  const shadowSourceCommit = env.NUSA_SOURCE_COMMIT_SHA ?? env.NUSA_SOURCE_COMMIT ?? "";
  const restoredShadow = readBaselineShadowRecord(config.cloudStateDbPath);
  // 0.0005 is the PAPER execution loop's default fee per side, the rate its own fills are charged.
  const baselineShadow = ownerBaselineStrategyEnabled(env) && isOwnerBaselineSourceCommitSha(shadowSourceCommit)
    ? new PaperBaselineShadow({ spec: ownerBaselineStrategySpec(shadowSourceCommit), feeRate: 0.0005, now: Date.now, ...(restoredShadow === undefined ? {} : { restore: restoredShadow }) })
    : undefined;
  const dashboardHydrator = new CloudRuntimeDashboardHydrator({
    paperCandidateBindingProvider,
    paperCandidateMinuteCloses: (market, now) => {
      const bars = minuteBars.read(market, now);
      baselineShadow?.observe(market, bars);
      return bars;
    },
  });

  // Own the canonical PAPER repository/loop at this composition root so the same process can
  // supply restart-safe candidate performance evidence without opening a second writer lease.
  const paperRepository = config.paperInitialCapitalKrw === undefined
    ? undefined
    : new SqliteCloudPaperAccountRepository(database, { accountId: paperAccountIdForCapital(config.paperInitialCapitalKrw) });
  const paperLoop = config.paperInitialCapitalKrw === undefined || paperRepository == null
    ? undefined
    : new PaperTradingExecutionLoop({ initialCapital: config.paperInitialCapitalKrw, repository: paperRepository });

  // Continuous research experiments: disabled unless NUSA_CLOUD_RESEARCH_EXPERIMENTS=1 (see researchExperimentComposition.ts).
  const researchExperiments = composeResearchExperiments({ env, database, log: (line) => console.log(line) });
  const loopStatus = new ClosedLearningLoopStatusTracker();
  // The last BLOCKED/ERROR reason survives a restart (display only; a reason seen by this process always wins).
  loopStatus.seedLastBlocked(readClosedLearningBlocked(config.cloudStateDbPath));
  let persistedBlockedAt = loopStatus.lastBlockedRecord()?.at;
  const persistLastBlocked = (): void => {
    const current = loopStatus.lastBlockedRecord();
    if (current == null || current.at === persistedBlockedAt) return;
    // Advance the marker only after a successful write, so a transient failure is retried on a later tick.
    if (recordClosedLearningBlocked(config.cloudStateDbPath, current)) persistedBlockedAt = current.at;
  };
  const baseHandle = startCloudRuntime(
    env,
    undefined,
    dashboardHydrator,
    undefined,
    snapshots,
    paperRepository,
    paperLoop,
    undefined,
    undefined,
    researchExperiments?.orchestrator,
    createCloudAiRuntime(env),
    undefined,
    undefined,
    undefined,
    undefined,
    () => loopStatus.snapshot(),
    () => researchExperiments?.experimentTicksByInterval() ?? null,
  );

  const readCanonicalPaperAccount = (): PaperAccountState | undefined => paperLoop?.snapshot();
  const requireCanonicalPaperAccount = (): PaperAccountState => {
    const account = readCanonicalPaperAccount();
    if (account == null) throw new Error("closed learning canonical PAPER account is unavailable");
    return account;
  };

  // Read pending plans from the exact persisted ledger owned by startCloudRuntime. This is a
  // checksum-bound read-only view, not a second PaperRealizedPeriodProducer or writer path.
  const pendingPeriods = new ClosedLearningPendingPeriodReader(database);
  const periods = Object.freeze({
    listOpenPeriods: () => pendingPeriods.list(),
    listRealizedPeriods: () => baseHandle.listPaperRealizedPeriods(),
    openPeriodFromCanonicalAccount: (input: Parameters<CloudRuntimeHandle["openPaperRealizedPeriodFromCanonicalAccount"]>[0]) => baseHandle.openPaperRealizedPeriodFromCanonicalAccount(input),
    closePeriodFromCanonicalAccount: (input: Parameters<CloudRuntimeHandle["closePaperRealizedPeriodFromCanonicalAccount"]>[0]) => baseHandle.closePaperRealizedPeriodFromCanonicalAccount(input),
    retireOpenPeriodForReplacement: (periodId: string, reason: string) => baseHandle.retirePaperRealizedPeriodForReplacement(periodId, reason),
    retireOpenPeriodForAccountChange: (periodId: string) => baseHandle.retirePaperRealizedPeriodForAccountChange(periodId),
    retireOpenPeriodForUnstreamedMarket: (periodId: string, streamedMarkets: readonly string[]) => baseHandle.retirePaperRealizedPeriodForUnstreamedMarket(periodId, streamedMarkets),
    retireOpenPeriodForMixedBinding: (periodId: string) => baseHandle.retirePaperRealizedPeriodForMixedBinding(periodId),
    inspectOpenPeriodForMixedBinding: (periodId: string) => baseHandle.inspectPaperRealizedPeriodForMixedBinding(periodId),
  });

  const replaySnapshots = new FileResearchRunReplaySnapshotStore(closedLearningConfig.researchReplaySnapshotPath);
  const replayInput = new ClosedLearningLineageReplayInputSource({
    periods,
    bindings: challengerBindings,
    readCanonicalPaperAccount,
    executionQualityPolicy: closedLearningConfig.executionQualityPolicy,
  });
  const worker = new ClosedLearningResearchWorkerClient({ snapshotPath: closedLearningConfig.researchReplaySnapshotPath });
  const history = new ClosedLearningResearchDecisionHistory(database);
  const artifacts = new FileQualifiedPaperChallengerArtifactStore(closedLearningConfig.qualifiedArtifactPath);
  const researchFactory = new ClosedLearningProductionResearchAdapter({ replayInput, worker, history, artifacts });
  const cycleRepository = new ClosedLearningEvolutionLedgerRepository(learningLedger);
  const paperDeployment = new PaperChallengerDeploymentRuntime({
    artifacts,
    bindings: challengerBindings,
    periods,
    readCanonicalPaperAccount: requireCanonicalPaperAccount,
    // Canonical Strategy Governance approval for PAPER challengers (ADR-0018, amended): on by
    // default on the PAPER host; NUSA_PAPER_CHALLENGER_POLICY_APPROVAL=DISABLED makes candidates wait.
    governance: new PaperChallengerPolicyApproval({ artifacts, enabled: paperChallengerPolicyEnabled(env) }),
  });
  const coordinator = new ClosedLearningLoopCoordinator(cycleRepository, researchFactory, paperDeployment);
  const runClosedLearningCycle = (input: ClosedLearningEvidenceIdentity): ClosedLearningCycleResult => coordinator.run(input);
  const runClosedLearningCycleAsync = (input: ClosedLearningEvidenceIdentity): Promise<ClosedLearningCycleResult> => coordinator.runAsync(input);

  const bootstrap = new ClosedLearningInitialPaperBootstrap({
    snapshots: replaySnapshots,
    worker,
    history,
    artifacts,
    deployment: paperDeployment,
    listOpenPeriods: periods.listOpenPeriods,
    listRealizedPeriods: periods.listRealizedPeriods,
  });
  const runClosedLearningBootstrap = (): ClosedLearningInitialPaperBootstrapResult => bootstrap.runOnce();
  const runClosedLearningBootstrapAsync = (): Promise<ClosedLearningInitialPaperBootstrapResult> => bootstrap.runOnceAsync();

  const evidenceIdentity = new ClosedLearningEvidenceIdentitySource({
    bindings: challengerBindings,
    replaySnapshots,
    readRiskConfigHash: () => CLOUD_PAPER_RISK_POLICY_FINGERPRINT,
  });
  const rollover = new ClosedLearningRolloverScheduler({
    listOpenPeriods: periods.listOpenPeriods,
    listRealizedPeriods: periods.listRealizedPeriods,
    readCanonicalPaperAccount,
    now: () => Date.now(),
    closePeriodFromCanonicalAccount: periods.closePeriodFromCanonicalAccount,
    openPeriodFromCanonicalAccount: periods.openPeriodFromCanonicalAccount,
    retireOpenPeriodForAccountChange: periods.retireOpenPeriodForAccountChange,
    retireOpenPeriodForReplacement: periods.retireOpenPeriodForReplacement,
    retireOpenPeriodForUnstreamedMarket: periods.retireOpenPeriodForUnstreamedMarket,
    retireOpenPeriodForMixedBinding: periods.retireOpenPeriodForMixedBinding,
    inspectOpenPeriodForMixedBinding: periods.inspectOpenPeriodForMixedBinding,
    streamedMarkets: () => config.upbitMarkets,
    buildOwnerBaselinePeriod: ({ periodIndex, periodStartAt }) => {
      const sourceCommitSha = env.NUSA_SOURCE_COMMIT_SHA ?? env.NUSA_SOURCE_COMMIT ?? "";
      const market = config.upbitMarkets[0];
      if (!ownerBaselineStrategyEnabled(env) || market == null || !isOwnerBaselineSourceCommitSha(sourceCommitSha) || !isOwnerBaselinePeriodStartAt(periodStartAt)) return undefined;
      return buildOwnerBaselinePaperPeriodInput({ market, periodIndex, periodStartAt, sourceCommitSha });
    },
    buildEvidenceIdentity: (window) => evidenceIdentity.build(window),
    runClosedLearningCycle,
    runClosedLearningCycleAsync,
  });
  const runClosedLearningRollover = (): ClosedLearningRolloverResult => rollover.runOnce();
  const runClosedLearningRolloverAsync = (): Promise<ClosedLearningRolloverResult> => rollover.runOnceAsync();

  const readPaperPerformanceEvidence = (periodId: string): PaperPerformanceFromLedgerResult => {
    const normalized = periodId.trim();
    if (!normalized) throw new Error("PAPER_PERFORMANCE_PERIOD_ID_REQUIRED");
    if (paperRepository?.loadHistory == null) throw new Error("PAPER_PERFORMANCE_DURABLE_HISTORY_UNAVAILABLE");
    if (paperRepository.loadFills == null) throw new Error("PAPER_PERFORMANCE_DURABLE_FILL_LEDGER_UNAVAILABLE");
    const matches = baseHandle.listPaperRealizedPeriods().filter((period) => period.record.recordId === normalized);
    if (matches.length !== 1) throw new Error(matches.length === 0 ? "PAPER_PERFORMANCE_PERIOD_NOT_FOUND" : "PAPER_PERFORMANCE_PERIOD_ID_CONFLICT");
    return buildPaperPerformanceFromLedger({
      period: matches[0]!,
      accountHistory: paperRepository.loadHistory(),
      durableFills: paperRepository.loadFills(),
    });
  };

  const evaluatePaperGovernanceFeedback = (input: Readonly<{
    periodId: string;
    now: number;
    identity: StrategyIdentity;
    validation?: StrategyValidationSummary;
    votes: readonly CommitteeVote[];
  }>): PaperPerformanceGovernanceFeedbackReceipt => {
    const ledgerPerformance = readPaperPerformanceEvidence(input.periodId);
    const adapted = adaptPersistedPaperForwardEvidence(baseHandle.listPaperRealizedPeriods());
    const candidate = adapted.candidates.find((item) => item.candidateId === ledgerPerformance.evidence.candidateId);
    const candidatePeriods = candidate?.periods.filter((period) => period.periodEndAt <= ledgerPerformance.evidence.periodEndAt) ?? [];
    const paper = candidatePeriods.length === 0 ? undefined : buildCanonicalPaperCandidatePerformance({
      candidateId: ledgerPerformance.evidence.candidateId,
      periods: candidatePeriods,
      account: requireCanonicalPaperAccount(),
      executionQualityPolicy: closedLearningConfig.executionQualityPolicy,
    });
    return evaluatePaperPerformanceGovernanceFeedback({
      now: input.now,
      identity: input.identity,
      validation: input.validation,
      paper,
      votes: input.votes,
      ledgerPerformance,
    });
  };

  // Closed learning is serialized and asynchronous. Research/League can be CPU-heavy on the
  // Oracle host, but it must never block the Node HTTP loop that serves /health, /ready, or the
  // monitoring UI. The async child-process boundary preserves all existing mutation ordering.
  let stopping = false;
  let closedLearningTick: Promise<void> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  let rolloverTimer: ReturnType<typeof setInterval> | undefined;
  let stopPromise: Promise<void> | undefined;

  const researchRefresh = new ResearchSnapshotRefresher({
    cloudStateDbPath: config.cloudStateDbPath,
    env,
    log: (line) => console.log(line),
  });

  const ensureOwnerBaselinePeriod = (): void => {
    if (!ownerBaselineStrategyEnabled(env) || periods.listOpenPeriods().length > 0 || periods.listRealizedPeriods().length > 0) return;
    const account = readCanonicalPaperAccount();
    if (account == null || !isOwnerBaselinePeriodStartAt(account.updatedAt)) return;
    const sourceCommitSha = env.NUSA_SOURCE_COMMIT_SHA ?? env.NUSA_SOURCE_COMMIT ?? "";
    if (!isOwnerBaselineSourceCommitSha(sourceCommitSha)) return;
    const market = config.upbitMarkets[0];
    if (market == null) return;
    const periodIndex = periods.listRealizedPeriods().reduce((maximum, item) => Math.max(maximum, item.record.periodIndex), -1) + 1;
    const input = buildOwnerBaselinePaperPeriodInput({
      market,
      periodIndex,
      periodStartAt: account.updatedAt,
      sourceCommitSha,
    });
    periods.openPeriodFromCanonicalAccount(input);
  };

  const runClosedLearningTick = (): Promise<void> => {
    if (stopping) return Promise.resolve();
    if (closedLearningTick != null) return closedLearningTick;
    // Durable cycle history is read first, so /health still shows the last lap while the bootstrap or rollover below is failing,
    // and withdrawn whole if the ledger cannot be read (never stale evidence presented as current).
    const refreshDurableCycles = (): void => {
      try { loopStatus.observeDurableCycles(cycleRepository.summary()); } catch { loopStatus.clearDurableCycles(); }
    };
    const task = (async () => {
      refreshDurableCycles();
      const bootstrap = await runClosedLearningBootstrapAsync();
      loopStatus.observeBootstrap(bootstrap);
      // If Research has no deployable snapshot, preserve the canonical PAPER loop by opening one
      // truthful market-bound owner-baseline period. The period uses the same account boundary and
      // provenance as the executable baseline binding; it never fabricates fills or benchmark data.
      if (bootstrap.status === "WAITING_RESEARCH_SNAPSHOT" || bootstrap.status === "RESEARCH_NOT_DEPLOYABLE" || bootstrap.status === "WAITING_GOVERNANCE_APPROVAL") {
        if (bootstrap.status === "WAITING_RESEARCH_SNAPSHOT") researchRefresh.requestIfDue();
        ensureOwnerBaselinePeriod();
      }
      loopStatus.observeRollover(await runClosedLearningRolloverAsync(), Date.now());
      persistLastBlocked();
      if (baselineShadow != null) {
        loopStatus.observeShadow(baselineShadow.summary());
        const persistable = baselineShadow.takePersistable();
        if (persistable != null && !writeBaselineShadowRecord(config.cloudStateDbPath, persistable)) baselineShadow.markUnpersisted();
      }
      refreshDurableCycles();
      try { loopStatus.observePeriods(periods.listOpenPeriods()[0], periods.listRealizedPeriods()); } catch { /* display only */ }
    })().catch((error: unknown) => { loopStatus.observeError(Date.now()); persistLastBlocked(); throw error; });
    closedLearningTick = task;
    task.then(
      () => { if (closedLearningTick === task) closedLearningTick = undefined; },
      () => { if (closedLearningTick === task) closedLearningTick = undefined; },
    );
    return task;
  };

  const handle: CloudRuntimeHandle = Object.freeze({
    ...baseHandle,
    stop: () => {
      if (stopPromise != null) return stopPromise;
      stopping = true;
      researchRefresh.stop();
      researchExperiments?.stop();
      if (initialTimer != null) clearTimeout(initialTimer);
      if (rolloverTimer != null) clearInterval(rolloverTimer);
      const pending = closedLearningTick;
      stopPromise = (async () => {
        if (pending != null) {
          try { await pending; } catch { /* fail-closed shutdown continues */ }
        }
        await baseHandle.stop();
      })();
      return stopPromise;
    },
  });

  const failClosedScheduler = (error: unknown): void => {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim().slice(0, 500) : "CLOSED_LEARNING_SCHEDULER_FAILED";
    console.error(`[closed-learning] scheduler failed closed: ${detail}`);
    recordRuntimeFailure(config.cloudStateDbPath, "CLOSED_LEARNING_SCHEDULER", error);
    process.exitCode = 1;
    void handle.stop();
  };
  const scheduleTick = (): void => { void runClosedLearningTick().catch(failClosedScheduler); };

  // Recovery/bootstrap must not wait for a human or app launch. Defer the first async tick just
  // enough for the HTTP listener to become serviceable, then keep one serialized rollover poll.
  initialTimer = setTimeout(scheduleTick, 0);
  initialTimer.unref?.();
  rolloverTimer = setInterval(scheduleTick, CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS);
  rolloverTimer.unref?.();
  researchExperiments?.start();

  return Object.freeze({
    handle,
    challengerBindings,
    readCanonicalPaperAccount,
    runClosedLearningCycle,
    runClosedLearningCycleAsync,
    runClosedLearningBootstrap,
    runClosedLearningBootstrapAsync,
    runClosedLearningRollover,
    runClosedLearningRolloverAsync,
    readPaperPerformanceEvidence,
    evaluatePaperGovernanceFeedback,
  });
}

function main(): void {
  const stateDbPath = process.env.NUSA_CLOUD_STATE_DB_PATH;
  let composition: ReturnType<typeof startClosedLearningProductionRuntime>;
  try {
    composition = startClosedLearningProductionRuntime(process.env);
  } catch (error) {
    // Start-up faults happen before the fatal handlers exist; record them so the loop is visible.
    if (stateDbPath !== undefined) recordRuntimeFailure(stateDbPath, "STARTUP", error);
    throw error;
  }
  registerGracefulShutdown(composition.handle, process.exit, stateDbPath);
}

if (require.main === module) main();
