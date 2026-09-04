import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { readCloudRuntimeConfig } from "./cloudRuntimeConfig";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { SqliteCloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountState } from "./paperTradingExecutionLoop";
import { createCloudAiRuntime } from "./ai/runtime";
import { registerGracefulShutdown, startCloudRuntime, type CloudRuntimeHandle } from "./runtime";

export interface ClosedLearningProductionComposition {
  readonly handle: CloudRuntimeHandle;
  readonly challengerBindings: PaperChallengerBindingLedger;
  /**
   * Read-only view of the exact canonical PAPER loop owned by this production process.
   * Closed-learning evidence consumers use this instead of opening a second account repository
   * or acquiring a competing writer lease.
   */
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
}

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 *
 * It deliberately reuses the existing Cloud runtime, SQLite state database, CIO, risk gate,
 * PAPER execution/accounting, and Evolution Learning ledger. The only additional authority is
 * a read-only active-challenger provenance provider. No LIVE route or production champion
 * mutation is introduced here.
 */
export function startClosedLearningProductionRuntime(env: NodeJS.ProcessEnv = process.env): ClosedLearningProductionComposition {
  const config = readCloudRuntimeConfig(env);
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
  return Object.freeze({
    handle,
    challengerBindings,
    readCanonicalPaperAccount: () => paperLoop?.snapshot(),
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
