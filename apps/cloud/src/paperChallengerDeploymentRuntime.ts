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
