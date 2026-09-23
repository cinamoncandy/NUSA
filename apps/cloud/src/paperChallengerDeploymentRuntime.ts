import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { bindPaperCandidateForExecution } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PaperRealizedPeriodOpenInput, PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";
import type {
  ClosedLearningPaperDeploymentReceipt,
  ClosedLearningResearchDecision,
  PaperChallengerDeploymentAdapter,
} from "./closedLearningLoopCoordinator";

/**
 * The exact, current, immutable Strategy Governance authorization for one candidate to execute as a
 * PAPER challenger. Returned by the canonical Governance service; this runtime never derives it.
 */
export interface StrategyGovernanceChallengerAuthorization {
  readonly strategyId: string;
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly familyId: string;
  readonly evidenceFingerprintSha256: string;
  readonly lifecycle: string;
  readonly approval: Readonly<{
    readonly actorType: string;
    readonly approvalReference: string;
    readonly approvedAt: number;
    readonly decisionFingerprint: string;
  }>;
}

/**
 * Fail-closed port onto canonical Strategy Governance. It must throw — never return a partial or
 * permissive answer — when the candidate is not currently an approved CHALLENGER.
 */
export interface StrategyGovernanceChallengerApprovalPort {
  requireExecutableChallenger(request: Readonly<{
    readonly candidateId: string;
    readonly candidateVersion: string;
    readonly familyId: string;
    readonly evidenceFingerprintSha256: string;
  }>): StrategyGovernanceChallengerAuthorization;
}

const SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;

/**
 * Verifies the Governance answer against the exact identity it was asked about, and refuses anything
 * that is not a current HUMAN- or ADR-0018 POLICY-approved CHALLENGER.
 *
 * The port is not trusted blindly: a port that returned some other candidate's valid approval, or an
 * approval for a different family, version or evidence, would otherwise authorize the wrong
 * deployment. Every field is compared back against the request.
 */
function requireExecutableChallengerAuthorization(
  governance: StrategyGovernanceChallengerApprovalPort | undefined,
  request: Readonly<{ candidateId: string; candidateVersion: string; familyId: string; evidenceFingerprintSha256: string }>,
): StrategyGovernanceChallengerAuthorization {
  if (governance == null) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE");
  const authorization = governance.requireExecutableChallenger(request);
  if (authorization == null || typeof authorization !== "object") throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE");
  if (
    authorization.candidateId !== request.candidateId ||
    authorization.candidateVersion !== request.candidateVersion ||
    authorization.familyId !== request.familyId ||
    authorization.evidenceFingerprintSha256 !== request.evidenceFingerprintSha256
  ) throw new Error("PAPER_CHALLENGER_GOVERNANCE_IDENTITY_MISMATCH");
  if (!safeText(authorization.strategyId, "governance strategyId")) throw new Error("PAPER_CHALLENGER_GOVERNANCE_IDENTITY_MISMATCH");
  // Only CHALLENGER is executable. SUSPENDED, ROLLED_BACK, RETIRED, REJECTED, PAPER_ACTIVE,
  // PROMOTION_PENDING and CHAMPION all fail closed here rather than being enumerated as exceptions.
  if (authorization.lifecycle !== "CHALLENGER") throw new Error("PAPER_CHALLENGER_GOVERNANCE_LIFECYCLE_INVALID");
  const approval = authorization.approval;
  // AI and AXIOM cannot approve their own candidate into execution. Besides HUMAN, only the
  // owner-approved deterministic PAPER challenger policy (ADR-0018) may approve, and only under its
  // own policy: reference namespace.
  if (approval == null) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID");
  const policyApproval = approval.actorType === "POLICY" && approval.approvalReference?.startsWith("policy:") === true;
  if (approval.actorType !== "HUMAN" && !policyApproval) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID");
  if (!APPROVAL_REFERENCE.test(approval.approvalReference)) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID");
  if (!SHA256.test(approval.decisionFingerprint)) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID");
  if (!Number.isSafeInteger(approval.approvedAt) || approval.approvedAt < 0) throw new Error("PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID");
  return authorization;
}

export interface QualifiedPaperChallengerArtifact {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly market: string;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
  /** Exact immutable strategy semantics copied from the qualified Research candidate. */
  readonly candidateStrategy?: PaperCandidateStrategySpec;
  readonly researchDecisionReference: string;
  /** Legacy stored artifacts may omit lineage, but autonomous deployment must fail closed on them. */
  readonly researchLineage?: PaperResearchLineage;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface QualifiedPaperChallengerArtifactReader {
  read(candidateId: string, candidateVersion: string): QualifiedPaperChallengerArtifact | undefined;
}

export interface CanonicalPaperPeriodPort {
  openPeriodFromCanonicalAccount(input: PaperRealizedPeriodOpenInput): PersistedPaperRealizedPeriodPlan;
  listRealizedPeriods(): readonly PersistedPaperPeriodEnvelope[];
}

export interface PaperChallengerDeploymentRuntimeOptions {
  readonly artifacts: QualifiedPaperChallengerArtifactReader;
  readonly bindings: Pick<PaperChallengerBindingLedger, "activate" | "current" | "revoke">;
  readonly periods: CanonicalPaperPeriodPort;
  readonly readCanonicalPaperAccount: () => PaperAccountState;
  /**
   * Required. Qualification proves a candidate is good enough to be considered; it does not approve
   * it to execute. Without this port the runtime cannot tell the two apart, so it refuses to deploy
   * rather than binding an unapproved candidate to a PAPER period.
   */
  readonly governance?: StrategyGovernanceChallengerApprovalPort;
}

const MARKET = /^KRW-[A-Z0-9-]+$/;
const safeText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) throw new Error(`${field} is invalid`);
  return normalized;
};

function qualifiedDecision(value: ClosedLearningResearchDecision): asserts value is ClosedLearningResearchDecision & { readonly candidateId: string; readonly candidateVersion: string } {
  if (value.outcome !== "QUALIFIED_FOR_LEAGUE" || !value.candidateId?.trim() || !value.candidateVersion?.trim()) throw new Error("PAPER challenger deployment requires a qualified immutable candidate");
}

function nextPeriodIndex(periods: readonly PersistedPaperPeriodEnvelope[]): number {
  const maximum = periods.reduce((value, item) => Math.max(value, item.record.periodIndex), -1);
  if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) throw new Error("PAPER period index is unavailable");
  return maximum + 1;
}

/**
 * Thin production adapter from an already-qualified immutable Research/League artifact into the
 * existing canonical PAPER binding and realized-period machinery. It owns no League score,
 * candidate generation, model training, broker, capital policy, or LIVE authority.
 */
export class PaperChallengerDeploymentRuntime implements PaperChallengerDeploymentAdapter {
  public constructor(private readonly options: PaperChallengerDeploymentRuntimeOptions) {}

  public deploy(input: {
    readonly cycleId: string;
    readonly decision: ClosedLearningResearchDecision & { readonly candidateId: string; readonly candidateVersion: string };
    readonly authority: "PAPER_RESEARCH_ONLY";
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  }): ClosedLearningPaperDeploymentReceipt {
    qualifiedDecision(input.decision);
    if (input.authority !== "PAPER_RESEARCH_ONLY" || input.liveAuthority !== "NONE" || input.productionMutationAllowed !== false || input.aiAuthority !== "ZERO_AUTHORITY") throw new Error("PAPER challenger deployment authority is invalid");
    const candidateId = safeText(input.decision.candidateId, "candidateId");
    const candidateVersion = safeText(input.decision.candidateVersion, "candidateVersion");
    const artifact = this.options.artifacts.read(candidateId, candidateVersion);
    if (artifact == null) throw new Error("qualified PAPER challenger artifact is unavailable");
    if (artifact.schemaVersion !== 1 || artifact.candidateId !== candidateId || artifact.candidateVersion !== candidateVersion) throw new Error("qualified PAPER challenger artifact identity conflict");
    if (artifact.liveAuthority !== "NONE" || artifact.productionMutationAllowed !== false || artifact.aiAuthority !== "ZERO_AUTHORITY") throw new Error("qualified PAPER challenger artifact authority is invalid");
    if (artifact.researchDecisionReference !== input.decision.decisionReference) throw new Error("qualified PAPER challenger decision provenance conflict");
    const researchLineage = artifact.researchLineage == null ? undefined : validatePaperResearchLineage(artifact.researchLineage);
    if (researchLineage == null) throw new Error("qualified PAPER challenger Research lineage is unavailable");
    if (researchLineage.candidateId !== candidateId || researchLineage.candidateVersion !== candidateVersion || researchLineage.researchDecisionReference !== input.decision.decisionReference) throw new Error("qualified PAPER challenger Research lineage conflict");
    const market = artifact.market.trim().toUpperCase();
    if (!MARKET.test(market)) throw new Error("qualified PAPER challenger market is invalid");

    const account = this.options.readCanonicalPaperAccount();
    if (account == null || account.version !== 1 || !Number.isSafeInteger(account.updatedAt) || account.updatedAt < 0) throw new Error("canonical PAPER account boundary is unavailable");
    const periodStartAt = account.updatedAt;
    if (artifact.candidateStrategy == null) throw new Error("qualified PAPER challenger strategy semantics are unavailable");
    if (artifact.candidateStrategy.specificationHash !== candidateVersion) throw new Error("qualified PAPER challenger strategy specification identity conflicts with candidate version");
    const binding = bindPaperCandidateForExecution(artifact.advisory, artifact.candidateProvenance, candidateId, periodStartAt, artifact.candidateStrategy);
    const periodId = `${input.cycleId}:paper:${binding.bindingFingerprintSha256}`;

    // Qualification is not authorization. Nothing below this line may revoke a binding, activate a
    // binding or open a PAPER period until canonical Strategy Governance says this exact candidate is
    // a currently approved CHALLENGER.
    const authorization = requireExecutableChallengerAuthorization(this.options.governance, {
      candidateId,
      candidateVersion,
      familyId: artifact.candidateStrategy.familyId,
      evidenceFingerprintSha256: binding.bindingFingerprintSha256,
    });
    void authorization;

    const prior = this.options.bindings.current(market, periodStartAt);
    if (prior != null && prior.binding.bindingFingerprintSha256 !== binding.bindingFingerprintSha256) {
      // A qualified challenger is a PAPER-only handoff, not concurrent authority. Revoke the
      // previous immutable binding at the exact canonical account boundary before activating the
      // replacement. If the process crashes after revoke or activate, coordinator replay resumes
      // this same deterministic deployment without rerunning Research.
      this.options.bindings.revoke(
        market,
        prior.binding.bindingFingerprintSha256,
        prior.binding.candidateId,
        periodStartAt,
        `SUPERSEDED_BY_QUALIFIED_CHALLENGER:${candidateId}`,
      );
    }

    const active = this.options.bindings.current(market, periodStartAt);
    if (active != null) {
      if (active.binding.bindingFingerprintSha256 !== binding.bindingFingerprintSha256 || active.binding.candidateId !== candidateId) throw new Error("another PAPER challenger is already active for this market");
      if (active.researchLineage == null || !samePaperResearchLineage(active.researchLineage, researchLineage)) throw new Error("existing PAPER challenger Research lineage conflict");
    } else {
      this.options.bindings.activate(market, binding, researchLineage);
    }

    const periodIndex = nextPeriodIndex(this.options.periods.listRealizedPeriods());
    this.options.periods.openPeriodFromCanonicalAccount({
      periodId,
      periodIndex,
      advisory: artifact.advisory,
      candidateProvenance: artifact.candidateProvenance,
      market,
      periodStartAt,
    });

    return Object.freeze({
      deploymentId: periodId,
      candidateId,
      candidateVersion,
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  }
}
