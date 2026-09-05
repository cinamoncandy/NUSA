import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { FileResearchRunReplaySnapshotStore } from "../../desktop/src/cloud/researchRunReplaySnapshotStore";
import { readCloudRuntimeConfig } from "./cloudRuntimeConfig";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { SqliteCloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountState } from "./paperTradingExecutionLoop";
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
  const snapshots = new SqliteCloudDashboardSnapshotRepository(database);
  const learningLedger = new SqliteEvolutionLearningLedger(database);
  const challengerBindings = new PaperChallengerBindingLedger(learningLedger);
  const dashboardHydrator = new CloudRuntimeDashboardHydrator({ paperCandidateBindingProvider: challengerBindings });

  // Own the canonical PAPER repository/loop at this composition root so the same process can
  // supply restart-safe candidate performance evidence without opening a second writer lease.
  const paperRepository = config.paperInitialCapitalKrw === undefined
    ? undefined
    : new SqliteCloudPaperAccountRepository(database);
  const paperLoop = config.paperInitialCapitalKrw === undefined || paperRepository == null
    ? undefined
    : new PaperTradingExecutionLoop({ initialCapital: config.paperInitialCapitalKrw, repository: paperRepository });

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
    undefined,
    createCloudAiRuntime(env),
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
    closePeriodFromCanonicalAccount: periods.closePeriodFromCanonicalAccount,
    openPeriodFromCanonicalAccount: periods.openPeriodFromCanonicalAccount,
    buildEvidenceIdentity: (window) => evidenceIdentity.build(window),
    runClosedLearningCycle,
    runClosedLearningCycleAsync,
  });
  const runClosedLearningRollover = (): ClosedLearningRolloverResult => rollover.runOnce();
  const runClosedLearningRolloverAsync = (): Promise<ClosedLearningRolloverResult> => rollover.runOnceAsync();

  // Closed learning is serialized and asynchronous. Research/League can be CPU-heavy on the
  // Oracle host, but it must never block the Node HTTP loop that serves /health, /ready, or the
  // monitoring UI. The async child-process boundary preserves all existing mutation ordering.
  let stopping = false;
  let closedLearningTick: Promise<void> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  let rolloverTimer: ReturnType<typeof setInterval> | undefined;
  let stopPromise: Promise<void> | undefined;

  const runClosedLearningTick = (): Promise<void> => {
    if (stopping) return Promise.resolve();
    if (closedLearningTick != null) return closedLearningTick;
    const task = (async () => {
      await runClosedLearningBootstrapAsync();
      await runClosedLearningRolloverAsync();
    })();
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
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
