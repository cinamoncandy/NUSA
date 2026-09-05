import { createHash } from "node:crypto";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { SqlitePersistedPaperPeriodStore } from "../../../packages/storage/src/persistedPaperPeriodStore";
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
import { ClosedLearningEvidenceIdentitySource } from "./closedLearningEvidenceIdentitySource";
import { ClosedLearningRolloverScheduler, type ClosedLearningRolloverResult } from "./closedLearningRolloverScheduler";
import { CLOUD_PAPER_RISK_POLICY_FINGERPRINT } from "./cloudPaperRiskPolicyIdentity";
import type { PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";

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
  /** Executes one canonical KST PAPER evidence rollover attempt. */
  readonly runClosedLearningRollover: () => ClosedLearningRolloverResult;
}

const ROLLOVER_INTERVAL_MS = 60_000;

function readValidatedOpenPeriods(store: SqlitePersistedPaperPeriodStore): readonly PersistedPaperRealizedPeriodPlan[] {
  return Object.freeze(store.listPending().map((pending) => {
    const digest = createHash("sha256").update(pending.payloadJson, "utf8").digest("hex");
    if (digest !== pending.checksum) throw new Error("closed-learning pending PAPER checksum mismatch");
    let parsed: unknown;
    try { parsed = JSON.parse(pending.payloadJson); } catch { throw new Error("closed-learning pending PAPER payload is malformed"); }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("closed-learning pending PAPER payload is invalid");
    const plan = parsed as PersistedPaperRealizedPeriodPlan;
    if (
      plan.schemaVersion !== 1 ||
      plan.periodId !== pending.periodId ||
      plan.periodIndex !== pending.periodIndex ||
      plan.periodStartAt !== pending.periodStartAt ||
      !Array.isArray(plan.observationIds) ||
      !Array.isArray(plan.observations) ||
      plan.observationIds.length !== plan.observations.length ||
      !Array.isArray(plan.candidateProvenance) ||
      plan.candidateProvenance.length === 0
    ) {
      throw new Error("closed-learning pending PAPER identity is invalid");
    }
    return Object.freeze(plan);
  }));
}

/**
 * Production composition root for autonomous PAPER + closed-learning candidate attribution.
 *
 * One process owns the canonical SQLite database, PAPER account loop, realized-period producer,
 * Research replay worker boundary, complete denominator history, immutable challenger artifacts,
 * replay-safe cycle ledger, next-PAPER deployment, and the canonical KST rollover scheduler.
 * No second PAPER writer, Research scoring engine, LIVE route, or production champion mutation is
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

  // Adapt the exact realized-period producer already owned inside startCloudRuntime. No second
  // realized-period repository is opened, which preserves the single-writer production boundary.
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
  const paperDeployment = new PaperChallengerDeploymentRuntime({
    artifacts,
    bindings: challengerBindings,
    periods,
    readCanonicalPaperAccount: requireCanonicalPaperAccount,
  });
  const coordinator = new ClosedLearningLoopCoordinator(cycleRepository, researchFactory, paperDeployment);

  const replaySnapshots = new FileResearchRunReplaySnapshotStore(closedLearningConfig.researchReplaySnapshotPath);
  const evidenceIdentity = new ClosedLearningEvidenceIdentitySource({
    bindings: challengerBindings,
    replaySnapshots,
    readRiskConfigHash: () => CLOUD_PAPER_RISK_POLICY_FINGERPRINT,
  });
  // Same SQLite connection, read-only pending-period projection. All period mutations still flow
  // through the single PaperRealizedPeriodProducer owned by startCloudRuntime.
  const pendingPeriods = new SqlitePersistedPaperPeriodStore(database);
  const rollover = new ClosedLearningRolloverScheduler({
    listOpenPeriods: () => readValidatedOpenPeriods(pendingPeriods),
    listRealizedPeriods: () => baseHandle.listPaperRealizedPeriods(),
    readCanonicalPaperAccount,
    closePeriodFromCanonicalAccount: (input) => baseHandle.closePaperRealizedPeriodFromCanonicalAccount(input),
    openPeriodFromCanonicalAccount: (input) => baseHandle.openPaperRealizedPeriodFromCanonicalAccount(input),
    buildEvidenceIdentity: (window) => evidenceIdentity.build(window),
    runClosedLearningCycle: (identity) => coordinator.run(identity),
  });
  const runClosedLearningRollover = (): ClosedLearningRolloverResult => rollover.runOnce();
  // Startup attempt recovers a boundary that may have elapsed while the process was down. The
  // coordinator and canonical period store remain replay-safe/idempotent boundaries.
  runClosedLearningRollover();
  const rolloverTimer = setInterval(() => {
    try { runClosedLearningRollover(); } catch { /* fail closed; next serial interval retries durable state */ }
  }, ROLLOVER_INTERVAL_MS);
  rolloverTimer.unref?.();

  const handle: CloudRuntimeHandle = Object.freeze({
    ...baseHandle,
    stop: async () => {
      clearInterval(rolloverTimer);
      await baseHandle.stop();
    },
  });

  return Object.freeze({
    handle,
    challengerBindings,
    readCanonicalPaperAccount,
    runClosedLearningCycle: (input: ClosedLearningEvidenceIdentity) => coordinator.run(input),
    runClosedLearningRollover,
  });
}

function main(): void {
  const composition = startClosedLearningProductionRuntime(process.env);
  registerGracefulShutdown(composition.handle);
}

if (require.main === module) main();
