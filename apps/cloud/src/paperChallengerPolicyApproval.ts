import { createHash } from "node:crypto";
import type { QualifiedPaperChallengerArtifactReader, StrategyGovernanceChallengerApprovalPort, StrategyGovernanceChallengerAuthorization } from "./paperChallengerDeploymentRuntime";
import { validatePaperResearchLineage } from "./paperResearchLineage";

/** Versioned identity of the deterministic PAPER challenger approval rule (ADR-0018). */
export const PAPER_CHALLENGER_POLICY_VERSION = "paper-challenger-policy-v1";
export const PAPER_CHALLENGER_POLICY_ENV = "NUSA_PAPER_CHALLENGER_POLICY_APPROVAL";

const SHA256 = /^[a-f0-9]{64}$/;

export interface PaperChallengerPolicyApprovalOptions {
  readonly artifacts: QualifiedPaperChallengerArtifactReader;
  /** Off unless the operator explicitly enables it; disabled means no approval exists. */
  readonly enabled: boolean;
  readonly now?: () => number;
}

/** Enabled only by the exact value ENABLED. Anything else, including absence, is disabled. */
export function paperChallengerPolicyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[PAPER_CHALLENGER_POLICY_ENV] === "ENABLED";
}

/**
 * Deterministic, owner-approved (ADR-0018) Strategy Governance approval for PAPER challengers.
 *
 * It approves exactly one thing: a candidate whose immutable qualified Research artifact is on
 * disk, carries valid PAPER-only Research lineage, and matches the requested identity. The Research
 * qualification gates (OOS, DSR, PBO, regime, League) already decided "good enough"; this rule is the
 * separate authorization step, re-checked here from the stored artifact rather than trusted from the
 * caller. It is code, not a model: AI still cannot approve anything, and it grants PAPER execution only.
 */
export class PaperChallengerPolicyApproval implements StrategyGovernanceChallengerApprovalPort {
  private readonly now: () => number;

  public constructor(private readonly options: PaperChallengerPolicyApprovalOptions) {
    this.now = options.now ?? Date.now;
  }

  public requireExecutableChallenger(request: Readonly<{
    readonly candidateId: string;
    readonly candidateVersion: string;
    readonly familyId: string;
    readonly evidenceFingerprintSha256: string;
  }>): StrategyGovernanceChallengerAuthorization {
    if (!this.options.enabled) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE");
    const candidateId = request.candidateId?.trim();
    const candidateVersion = request.candidateVersion?.trim();
    const familyId = request.familyId?.trim();
    if (!candidateId || !candidateVersion || !familyId || !SHA256.test(request.evidenceFingerprintSha256 ?? "")) {
      throw new Error("PAPER_CHALLENGER_POLICY_REQUEST_INVALID");
    }
    const artifact = this.options.artifacts.read(candidateId, candidateVersion);
    if (artifact == null) throw new Error("PAPER_CHALLENGER_POLICY_ARTIFACT_UNAVAILABLE");
    if (artifact.schemaVersion !== 1 || artifact.candidateId !== candidateId || artifact.candidateVersion !== candidateVersion) {
      throw new Error("PAPER_CHALLENGER_POLICY_ARTIFACT_IDENTITY_CONFLICT");
    }
    if (artifact.liveAuthority !== "NONE" || artifact.productionMutationAllowed !== false || artifact.aiAuthority !== "ZERO_AUTHORITY") {
      throw new Error("PAPER_CHALLENGER_POLICY_ARTIFACT_AUTHORITY_INVALID");
    }
    const strategy = artifact.candidateStrategy;
    if (strategy == null || strategy.familyId !== familyId || strategy.specificationHash !== candidateVersion) {
      throw new Error("PAPER_CHALLENGER_POLICY_STRATEGY_IDENTITY_CONFLICT");
    }
    if (artifact.researchLineage == null) throw new Error("PAPER_CHALLENGER_POLICY_LINEAGE_UNAVAILABLE");
    const lineage = validatePaperResearchLineage(artifact.researchLineage);
    if (lineage.candidateId !== candidateId || lineage.candidateVersion !== candidateVersion || lineage.researchDecisionReference !== artifact.researchDecisionReference) {
      throw new Error("PAPER_CHALLENGER_POLICY_LINEAGE_CONFLICT");
    }
    const approvedAt = this.now();
    if (!Number.isSafeInteger(approvedAt) || approvedAt < 0) throw new Error("PAPER_CHALLENGER_POLICY_CLOCK_INVALID");
    const decisionFingerprint = createHash("sha256").update(JSON.stringify([
      PAPER_CHALLENGER_POLICY_VERSION,
      candidateId,
      candidateVersion,
      familyId,
      request.evidenceFingerprintSha256,
      lineage.replayRunFingerprintSha256,
      lineage.researchDecisionReference,
    ])).digest("hex");
    return Object.freeze({
      strategyId: `${familyId}:${candidateId}`,
      candidateId,
      candidateVersion,
      familyId,
      evidenceFingerprintSha256: request.evidenceFingerprintSha256,
      lifecycle: "CHALLENGER",
      approval: Object.freeze({
        actorType: "POLICY",
        approvalReference: `policy:${PAPER_CHALLENGER_POLICY_VERSION}:${decisionFingerprint.slice(0, 16)}`,
        approvedAt,
        decisionFingerprint,
      }),
    });
  }
}
