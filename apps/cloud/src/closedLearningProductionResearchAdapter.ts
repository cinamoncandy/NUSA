import type { ClosedLearningEvidenceIdentity, ClosedLearningResearchDecision, ExistingResearchFactoryAdapter } from "./closedLearningLoopCoordinator";
import type { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";
import type { ClosedLearningResearchWorkerClient, ClosedLearningResearchReplayResult } from "./closedLearningResearchWorkerClient";
import type { QualifiedPaperChallengerArtifactWriter } from "./qualifiedPaperChallengerArtifactStore";

export interface ClosedLearningResearchReplayInput {
  readonly originalRunFingerprintSha256: string;
  readonly paperEvidenceByCandidate: Readonly<Record<string, unknown>>;
}

export interface ClosedLearningResearchReplayInputSource {
  resolve(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchReplayInput;
}

export interface ClosedLearningProductionResearchAdapterOptions {
  readonly replayInput: ClosedLearningResearchReplayInputSource;
  readonly worker: Pick<ClosedLearningResearchWorkerClient, "replay" | "replayAsync">;
  readonly history: Pick<ClosedLearningResearchDecisionHistory, "persist">;
  readonly artifacts: QualifiedPaperChallengerArtifactWriter;
  readonly now?: () => number;
}

const SHA256 = /^[a-f0-9]{64}$/;

function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("closed learning Research observation clock is invalid");
  return value;
}

function replayDecisionId(result: ClosedLearningResearchReplayResult, suffix: string): string {
  return `closed-learning-replay:${result.replayRunFingerprintSha256}:${suffix}`;
}

/**
 * Production Research adapter with strict mutation ordering:
 * canonical worker replay -> complete denominator history -> immutable qualified artifact ->
 * coordinator decision. It owns no Research metric, League ranking, PAPER execution, broker,
 * champion mutation, or LIVE authority.
 */
export class ClosedLearningProductionResearchAdapter implements ExistingResearchFactoryAdapter {
  private readonly now: () => number;

  public constructor(private readonly options: ClosedLearningProductionResearchAdapterOptions) {
    this.now = options.now ?? Date.now;
  }

  private prepare(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchReplayInput {
    const replayInput = this.options.replayInput.resolve(input);
    const originalRunFingerprintSha256 = replayInput.originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA256.test(originalRunFingerprintSha256)) throw new Error("closed learning original Research fingerprint is invalid");
    if (replayInput.paperEvidenceByCandidate == null || typeof replayInput.paperEvidenceByCandidate !== "object" || Array.isArray(replayInput.paperEvidenceByCandidate) || Object.keys(replayInput.paperEvidenceByCandidate).length === 0) {
      throw new Error("closed learning PAPER replay evidence is unavailable");
    }
    return Object.freeze({ originalRunFingerprintSha256, paperEvidenceByCandidate: replayInput.paperEvidenceByCandidate });
  }

  private finalize(originalRunFingerprintSha256: string, result: ClosedLearningResearchReplayResult): ClosedLearningResearchDecision {
    if (result.originalRunFingerprintSha256 !== originalRunFingerprintSha256) throw new Error("closed learning Research replay provenance conflict");

    // This persistence boundary MUST complete before an artifact can become visible to PAPER deployment.
    this.options.history.persist(result, timestamp(this.now()));

    if (result.deployment.status === "DEPLOYABLE") {
      const artifact = this.options.artifacts.save(result.deployment.artifact);
      if (
        artifact.candidateId !== result.deployment.artifact.candidateId
        || artifact.candidateVersion !== result.deployment.artifact.candidateVersion
        || artifact.researchDecisionReference !== result.deployment.artifact.researchDecisionReference
      ) throw new Error("closed learning persisted PAPER artifact identity conflict");
      return Object.freeze({
        decisionId: replayDecisionId(result, `qualified:${artifact.candidateId}`),
        outcome: "QUALIFIED_FOR_LEAGUE",
        candidateId: artifact.candidateId,
        candidateVersion: artifact.candidateVersion,
        decisionReference: artifact.researchDecisionReference,
        reasons: Object.freeze([...result.deployment.reasons]),
      });
    }

    const qualifiedCount = result.qualification.coverage.qualifiedCount;
    const insufficientCount = result.qualification.coverage.insufficientCount;
    const outcome = qualifiedCount > 0 || insufficientCount > 0 ? "INSUFFICIENT" : "REJECTED";
    const cycleReasons = qualifiedCount > 0
      ? [...result.deployment.reasons, "NO_UNAMBIGUOUS_PAPER_DEPLOYMENT"]
      : [...result.deployment.reasons];
    return Object.freeze({
      decisionId: replayDecisionId(result, "not-deployable"),
      outcome,
      decisionReference: replayDecisionId(result, "decision"),
      reasons: Object.freeze([...new Set(cycleReasons)].sort()),
    });
  }

  public evaluate(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchDecision {
    const replayInput = this.prepare(input);
    return this.finalize(
      replayInput.originalRunFingerprintSha256,
      this.options.worker.replay(replayInput.originalRunFingerprintSha256, replayInput.paperEvidenceByCandidate),
    );
  }

  /** Production runtime path: Research/League executes in a child process without blocking HTTP. */
  public async evaluateAsync(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): Promise<ClosedLearningResearchDecision> {
    const replayInput = this.prepare(input);
    return this.finalize(
      replayInput.originalRunFingerprintSha256,
      await this.options.worker.replayAsync(replayInput.originalRunFingerprintSha256, replayInput.paperEvidenceByCandidate),
    );
  }
}
