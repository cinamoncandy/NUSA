import type { ResearchRunReplaySnapshotReader } from "../../desktop/src/cloud/researchRunReplaySnapshotStore";
import type { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";
import type { ClosedLearningResearchReplayResult, ClosedLearningResearchWorkerClient } from "./closedLearningResearchWorkerClient";
import type { QualifiedPaperChallengerArtifactWriter } from "./qualifiedPaperChallengerArtifactStore";
import type { PaperChallengerDeploymentAdapter, ClosedLearningPaperDeploymentReceipt } from "./closedLearningLoopCoordinator";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";

export type ClosedLearningInitialPaperBootstrapStatus =
  | "WAITING_RESEARCH_SNAPSHOT"
  | "EXISTING_PAPER_STATE"
  | "RESEARCH_NOT_DEPLOYABLE"
  | "DEPLOYED";

export interface ClosedLearningInitialPaperBootstrapResult {
  readonly status: ClosedLearningInitialPaperBootstrapStatus;
  readonly originalRunFingerprintSha256?: string;
  readonly reasons?: readonly string[];
  readonly deployment?: ClosedLearningPaperDeploymentReceipt;
}

export interface ClosedLearningInitialPaperBootstrapOptions {
  readonly snapshots: ResearchRunReplaySnapshotReader;
  readonly worker: Pick<ClosedLearningResearchWorkerClient, "replayInitialResearch"> & Partial<Pick<ClosedLearningResearchWorkerClient, "replayInitialResearchAsync">>;
  readonly history: Pick<ClosedLearningResearchDecisionHistory, "persist">;
  readonly artifacts: QualifiedPaperChallengerArtifactWriter;
  readonly deployment: PaperChallengerDeploymentAdapter;
  readonly listOpenPeriods: () => readonly PersistedPaperRealizedPeriodPlan[];
  readonly listRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly now?: () => number;
}

function bootstrapDecision(result: ClosedLearningResearchReplayResult): Parameters<PaperChallengerDeploymentAdapter["deploy"]>[0]["decision"] {
  if (result.deployment.status !== "DEPLOYABLE") throw new Error("initial PAPER bootstrap deployment artifact is unavailable");
  const artifact = result.deployment.artifact;
  const qualified = result.qualification.candidates.filter((candidate) => candidate.candidateId === artifact.candidateId && candidate.outcome === "QUALIFIED_FOR_LEAGUE");
  if (qualified.length !== 1) throw new Error("initial PAPER bootstrap candidate qualification is ambiguous");
  return Object.freeze({
    decisionId: `initial-research:${result.replayRunFingerprintSha256}:${artifact.candidateId}`,
    outcome: "QUALIFIED_FOR_LEAGUE" as const,
    candidateId: artifact.candidateId,
    candidateVersion: artifact.candidateVersion,
    decisionReference: artifact.researchDecisionReference,
    reasons: Object.freeze([...result.deployment.reasons]),
  });
}

/**
 * Fail-closed first-PAPER bootstrap. It is only eligible before any PAPER period exists. The exact
 * latest immutable Research snapshot is replayed without synthetic PAPER evidence through the
 * same isolated canonical Research/League worker used by closed learning. The complete Research
 * denominator is persisted before an immutable artifact can become visible, then the existing
 * PAPER-only deployment adapter owns binding activation and canonical period open.
 *
 * Replay after a crash is safe: history/artifact writes are immutable/idempotent and deployment is
 * already deterministic for an identical binding/period boundary.
 */
export class ClosedLearningInitialPaperBootstrap {
  private readonly now: () => number;

  public constructor(private readonly options: ClosedLearningInitialPaperBootstrapOptions) {
    this.now = options.now ?? Date.now;
  }

  private hasExistingPaperState(): boolean {
    return this.options.listOpenPeriods().length > 0 || this.options.listRealizedPeriods().length > 0;
  }

  private eligibleFingerprint(): { readonly early?: ClosedLearningInitialPaperBootstrapResult; readonly fingerprint?: string } {
    if (this.hasExistingPaperState()) return Object.freeze({ early: Object.freeze({ status: "EXISTING_PAPER_STATE" }) });
    const snapshot = this.options.snapshots.latest();
    if (snapshot == null) return Object.freeze({ early: Object.freeze({ status: "WAITING_RESEARCH_SNAPSHOT" }) });
    return Object.freeze({ fingerprint: snapshot.originalRunFingerprintSha256 });
  }

  private async eligibleFingerprintAsync(): Promise<{ readonly early?: ClosedLearningInitialPaperBootstrapResult; readonly fingerprint?: string }> {
    if (this.hasExistingPaperState()) return Object.freeze({ early: Object.freeze({ status: "EXISTING_PAPER_STATE" }) });
    if (this.options.snapshots.latestIdentityAsync != null) {
      const identity = await this.options.snapshots.latestIdentityAsync();
      if (identity == null) return Object.freeze({ early: Object.freeze({ status: "WAITING_RESEARCH_SNAPSHOT" }) });
      return Object.freeze({ fingerprint: identity.originalRunFingerprintSha256 });
    }
    return this.eligibleFingerprint();
  }

  private finalize(originalRunFingerprintSha256: string, result: ClosedLearningResearchReplayResult): ClosedLearningInitialPaperBootstrapResult {
    const observedAt = this.now();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("initial PAPER bootstrap clock is invalid");

    // Denominator first. Artifact/deployment must never be visible if this durable write fails.
    this.options.history.persist(result, observedAt);
    if (result.deployment.status !== "DEPLOYABLE") {
      return Object.freeze({
        status: "RESEARCH_NOT_DEPLOYABLE",
        originalRunFingerprintSha256,
        reasons: Object.freeze([...result.deployment.reasons]),
      });
    }

    const artifact = this.options.artifacts.save(result.deployment.artifact);
    if (artifact.candidateId !== result.deployment.artifact.candidateId || artifact.candidateVersion !== result.deployment.artifact.candidateVersion) {
      throw new Error("initial PAPER bootstrap persisted artifact identity drifted");
    }
    const decision = bootstrapDecision(result);
    const deployment = this.options.deployment.deploy({
      cycleId: `closed-learning-initial:${result.replayRunFingerprintSha256}`,
      decision,
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
    return Object.freeze({
      status: "DEPLOYED",
      originalRunFingerprintSha256,
      deployment,
    });
  }

  public runOnce(): ClosedLearningInitialPaperBootstrapResult {
    const eligible = this.eligibleFingerprint();
    if (eligible.early != null) return eligible.early;
    const fingerprint = eligible.fingerprint!;
    return this.finalize(fingerprint, this.options.worker.replayInitialResearch(fingerprint));
  }

  /** Async production path yields while the isolated Research/League child process executes when supported. */
  public async runOnceAsync(): Promise<ClosedLearningInitialPaperBootstrapResult> {
    const eligible = await this.eligibleFingerprintAsync();
    if (eligible.early != null) return eligible.early;
    const fingerprint = eligible.fingerprint!;
    const result = this.options.worker.replayInitialResearchAsync == null
      ? this.options.worker.replayInitialResearch(fingerprint)
      : await this.options.worker.replayInitialResearchAsync(fingerprint);
    return this.finalize(fingerprint, result);
  }
}
