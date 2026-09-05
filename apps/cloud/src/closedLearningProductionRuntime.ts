import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
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
}

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 *
 * One process owns the canonical SQLite database, PAPER account loop, realized-period producer,
 * Research replay worker boundary, complete denominator history, immutable challenger artifacts,
 * replay-safe cycle ledger, and next-PAPER deployment. No second PAPER writer, Research scoring
 * engine, LIVE route, or production champion mutation is introduced here.
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

  // Adapt the exact realized-period producer already owned inside startCloudRuntime. No second
  // realized-period repository is opened, which preserves the single-writer production boundary.
  const periods = Object.freeze({
    listRealizedPeriods: () => handle.listPaperRealizedPeriods(),
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

  return Object.freeze({
    handle,
    challengerBindings,
    readCanonicalPaperAccount,
    runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => coordinator.run(input),
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
