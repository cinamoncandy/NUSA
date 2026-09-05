import { createHash } from "node:crypto";
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
import { PaperClosedLearningEvidenceSource } from "./paperClosedLearningEvidenceSource";
import { ClosedLearningProductionScheduler } from "./closedLearningProductionScheduler";
import { ClosedLearningPaperRolloverScheduler } from "./closedLearningPaperRolloverScheduler";
import { SqlitePaperRealizedPeriodRepository } from "./paperRealizedPeriodProducer";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";

export interface ClosedLearningProductionComposition {
  readonly handle: CloudRuntimeHandle;
  readonly challengerBindings: PaperChallengerBindingLedger;
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => ClosedLearningCycleResult;
  readonly runClosedLearningRollover: () => unknown;
}

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 * One process owns the canonical SQLite database, PAPER account loop, realized-period producer,
 * Research replay worker boundary, denominator history, immutable challenger artifacts,
 * replay-safe cycle ledger, next-PAPER deployment, and evidence-window rollover scheduler.
 * No second PAPER writer, Research scoring engine, LIVE route, or production champion mutation exists.
 */
export function startClosedLearningProductionRuntime(env: NodeJS.ProcessEnv = process.env): ClosedLearningProductionComposition {
  const config = readCloudRuntimeConfig(env);
  const closedLearningConfig = readClosedLearningProductionConfig(env, config.cloudStateDbPath);
  const database = new SqliteDatabase(config.cloudStateDbPath);
  const snapshots = new SqliteCloudDashboardSnapshotRepository(database);
  const learningLedger = new SqliteEvolutionLearningLedger(database);
  const challengerBindings = new PaperChallengerBindingLedger(learningLedger);
  const dashboardHydrator = new CloudRuntimeDashboardHydrator({ paperCandidateBindingProvider: challengerBindings });

  const paperRepository = config.paperInitialCapitalKrw === undefined ? undefined : new SqliteCloudPaperAccountRepository(database);
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

  const periods = Object.freeze({
    listRealizedPeriods: () => baseHandle.listPaperRealizedPeriods(),
    openPeriodFromCanonicalAccount: (input: Parameters<CloudRuntimeHandle["openPaperRealizedPeriodFromCanonicalAccount"]>[0]) => baseHandle.openPaperRealizedPeriodFromCanonicalAccount(input),
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
  const paperDeployment = new PaperChallengerDeploymentRuntime({ artifacts, bindings: challengerBindings, periods, readCanonicalPaperAccount: requireCanonicalPaperAccount });
  const coordinator = new ClosedLearningLoopCoordinator(cycleRepository, researchFactory, paperDeployment);

  const activeContext = () => {
    const account = requireCanonicalPaperAccount();
    const active = config.upbitMarkets
      .map((market) => challengerBindings.current(market, account.updatedAt))
      .filter((item) => item != null);
    if (active.length > 1) throw new Error("closed learning has multiple active PAPER challengers across configured markets");
    return active[0];
  };
  const sourceCommitSha = env.NUSA_SOURCE_COMMIT?.trim().toLowerCase() ?? "";
  const evidence = new PaperClosedLearningEvidenceSource({
    listPaperRealizedPeriods: () => {
      const active = activeContext();
      if (active == null) return Object.freeze([]);
      return Object.freeze(baseHandle.listPaperRealizedPeriods().filter((period) =>
        period.record.market === active.market
        && period.record.periodStartAt >= active.activatedAt
        && period.candidateProvenance.length === 1
        && period.candidateProvenance[0]!.candidateId === active.binding.candidateId
        && period.candidateProvenance[0]!.datasetId === active.binding.datasetId
        && period.candidateProvenance[0]!.datasetContentSha256 === active.binding.datasetContentSha256
      ));
    },
    champion: () => {
      const active = activeContext();
      if (active == null || active.researchLineage == null) throw new Error("closed learning active PAPER Research lineage is unavailable");
      return Object.freeze({ championId: active.binding.candidateId, championVersion: active.researchLineage.candidateVersion });
    },
    sourceCommitSha,
    costModelVersion: "canonical-paper-execution-cost-v1",
    riskConfigHash: hash(CLOUD_PAPER_RISK_LIMITS),
    minimumPeriods: 1,
  });
  const cycleScheduler = new ClosedLearningProductionScheduler({ evidence, coordinator });

  // Read-only introspection over the same canonical SqliteDatabase connection. All mutations still
  // go through the single PaperRealizedPeriodProducer owned by startCloudRuntime.
  const pendingReader = new SqlitePaperRealizedPeriodRepository(database);
  const rollover = new ClosedLearningPaperRolloverScheduler({
    listPendingPeriods: () => pendingReader.listPending(),
    listRealizedPeriods: () => baseHandle.listPaperRealizedPeriods(),
    closePeriodFromCanonicalAccount: (input) => baseHandle.closePaperRealizedPeriodFromCanonicalAccount(input),
    openPeriodFromCanonicalAccount: (input) => baseHandle.openPaperRealizedPeriodFromCanonicalAccount(input),
    readCanonicalPaperAccount: requireCanonicalPaperAccount,
    bindings: challengerBindings,
    cycle: cycleScheduler,
    onError: (error) => console.error("[closed-learning-rollover]", error.message),
  });
  rollover.start();

  const handle: CloudRuntimeHandle = Object.freeze({
    ...baseHandle,
    stop: async () => {
      rollover.stop();
      cycleScheduler.stop();
      await baseHandle.stop();
    },
  });

  return Object.freeze({
    handle,
    challengerBindings,
    readCanonicalPaperAccount,
    runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => coordinator.run(input),
    runClosedLearningRollover: () => rollover.runOnce(),
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
