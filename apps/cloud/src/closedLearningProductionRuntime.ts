import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { SqlitePersistedPaperPeriodStore } from "../../../packages/storage/src/persistedPaperPeriodStore";
import { readCloudRuntimeConfig } from "./cloudRuntimeConfig";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { SqliteCloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountState } from "./paperTradingExecutionLoop";
import { createCloudAiRuntime } from "./ai/runtime";
import { registerGracefulShutdown, startCloudRuntime, type CloudRuntimeHandle } from "./runtime";
import { CLOSED_LEARNING_COST_MODEL_VERSION_V1, readClosedLearningProductionConfig } from "./closedLearningProductionConfig";
import { ClosedLearningResearchWorkerClient } from "./closedLearningResearchWorkerClient";
import { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";
import { FileQualifiedPaperChallengerArtifactStore } from "./qualifiedPaperChallengerArtifactStore";
import { ClosedLearningLineageReplayInputSource } from "./closedLearningLineageReplayInputSource";
import { ClosedLearningProductionResearchAdapter } from "./closedLearningProductionResearchAdapter";
import { ClosedLearningEvolutionLedgerRepository } from "./closedLearningEvolutionLedgerRepository";
import { ClosedLearningLoopCoordinator, type ClosedLearningCycleResult, type ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { PaperChallengerDeploymentRuntime } from "./paperChallengerDeploymentRuntime";
import { ClosedLearningPaperPeriodLifecycleScheduler, type ClosedLearningPaperPeriodLifecycleResult } from "./closedLearningPaperPeriodLifecycleScheduler";

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
  /** Executes one canonical period close/replay/rollover pass without waiting for the timer. */
  readonly runClosedLearningLifecycleOnce: () => ClosedLearningPaperPeriodLifecycleResult | undefined;
}

function closedLearningRiskConfigHash(initialCapitalKrw: number): string {
  return createHash("sha256").update(canonicalResearchJson(Object.freeze({
    schemaVersion: 1,
    initialCapitalKrw,
    limits: CLOUD_PAPER_RISK_LIMITS,
  })), "utf8").digest("hex");
}

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 *
 * One process owns the canonical SQLite database, PAPER account loop, realized-period producer,
 * Research replay worker boundary, complete denominator history, immutable challenger artifacts,
 * replay-safe cycle ledger, next-PAPER deployment, and evidence-period rollover scheduler. No
 * second PAPER writer, Research scoring engine, LIVE route, or production champion mutation is
 * introduced here.
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

  const handle = startCloudRuntime(
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

  // Read pending-period identity from the same canonical SQLite connection. All realized-period
  // mutations still go through the one producer already owned by startCloudRuntime.
  const paperPeriodStore = new SqlitePersistedPaperPeriodStore(database);
  const periods = Object.freeze({
    listOpenPeriods: () => paperPeriodStore.listPending(),
    listRealizedPeriods: () => handle.listPaperRealizedPeriods(),
    closePeriodFromCanonicalAccount: (input: Parameters<CloudRuntimeHandle["closePaperRealizedPeriodFromCanonicalAccount"]>[0]) => handle.closePaperRealizedPeriodFromCanonicalAccount(input),
    openPeriodFromCanonicalAccount: (input: Parameters<CloudRuntimeHandle["openPaperRealizedPeriodFromCanonicalAccount"]>[0]) => handle.openPaperRealizedPeriodFromCanonicalAccount(input),
  });
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

  const sourceCommitSha = (env.NUSA_SOURCE_COMMIT?.trim() || env.GITHUB_SHA?.trim() || "").toLowerCase();
  const lifecycle = paperLoop == null || config.paperInitialCapitalKrw === undefined
    ? undefined
    : new ClosedLearningPaperPeriodLifecycleScheduler({
      periods,
      bindings: challengerBindings,
      artifacts,
      coordinator,
      readCanonicalPaperAccount,
      sourceCommitSha,
      costModelVersion: CLOSED_LEARNING_COST_MODEL_VERSION_V1,
      riskConfigHash: closedLearningRiskConfigHash(config.paperInitialCapitalKrw),
      periodWindowMs: closedLearningConfig.paperPeriodWindowMs,
      intervalMs: closedLearningConfig.lifecycleIntervalMs,
      onError: (error) => console.error("[closed-learning-lifecycle]", error.message),
    });
  lifecycle?.start();

  const managedHandle: CloudRuntimeHandle = lifecycle == null ? handle : Object.freeze({
    ...handle,
    stop: async () => {
      lifecycle.stop();
      await handle.stop();
    },
  });

  return Object.freeze({
    handle: managedHandle,
    challengerBindings,
    readCanonicalPaperAccount,
    runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => coordinator.run(input),
    runClosedLearningLifecycleOnce: () => lifecycle?.runOnce(),
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
