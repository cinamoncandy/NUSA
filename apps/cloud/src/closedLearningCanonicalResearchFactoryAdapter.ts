import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";
import type { ClosedLearningResearchDecision, ClosedLearningEvidenceIdentity, ExistingResearchFactoryAdapter } from "./closedLearningLoopCoordinator";
import type { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";
import type { ClosedLearningResearchWorkerClient } from "./closedLearningResearchWorkerClient";
import type { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { QualifiedPaperChallengerArtifactWriter } from "./qualifiedPaperChallengerArtifactStore";

export interface ClosedLearningCanonicalPeriodSource {
  listRealizedPeriods(): readonly PersistedPaperPeriodEnvelope[];
}

export interface ClosedLearningCanonicalResearchFactoryAdapterOptions {
  readonly worker: Pick<ClosedLearningResearchWorkerClient, "replayCanonicalPaperEvidence">;
  readonly history: Pick<ClosedLearningResearchDecisionHistory, "persist">;
  readonly artifacts: QualifiedPaperChallengerArtifactWriter;
  readonly bindings: Pick<PaperChallengerBindingLedger, "current">;
  readonly periods: ClosedLearningCanonicalPeriodSource;
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
  readonly now?: () => number;
}

const MARKET = /^KRW-[A-Z0-9-]+$/;

function candidateOf(period: PersistedPaperPeriodEnvelope): string {
  if (period.candidateProvenance.length !== 1) throw new Error("closed learning canonical period must contain exactly one candidate provenance");
  const candidateId = period.candidateProvenance[0]!.candidateId.trim();
  if (!candidateId) throw new Error("closed learning canonical period candidate is invalid");
  return candidateId;
}

function marketOf(period: PersistedPaperPeriodEnvelope): string {
  const market = period.record.market?.trim().toUpperCase() ?? "";
  if (!MARKET.test(market)) throw new Error("closed learning canonical period market is invalid");
  return market;
}

function ordered(periods: readonly PersistedPaperPeriodEnvelope[]): readonly PersistedPaperPeriodEnvelope[] {
  return Object.freeze([...periods].sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.periodStartAt - right.record.periodStartAt || left.record.recordId.localeCompare(right.record.recordId)));
}

function uniqueReasons(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))].sort());
}

/**
 * Concrete production Research Factory adapter for the closed-learning coordinator.
 *
 * Exact Research lineage, not outcome, selects the realized PAPER window. Therefore rejected,
 * halted and completed periods belonging to that immutable challenger lineage remain in the
 * denominator. The process-isolated worker reuses the existing persisted-PAPER admission,
 * canonical performance, Research Factory and League implementations. The complete worker
 * denominator is durably written before any qualified artifact is materialized.
 */
export class ClosedLearningCanonicalResearchFactoryAdapter implements ExistingResearchFactoryAdapter {
  private readonly now: () => number;

  public constructor(private readonly options: ClosedLearningCanonicalResearchFactoryAdapterOptions) {
    this.now = options.now ?? Date.now;
  }

  private lineageFor(period: PersistedPaperPeriodEnvelope): PaperResearchLineage {
    const market = marketOf(period);
    const candidateId = candidateOf(period);
    const activation = this.options.bindings.current(market, period.record.periodStartAt);
    if (activation?.researchLineage == null) throw new Error("closed learning canonical period Research lineage is unavailable");
    const lineage = validatePaperResearchLineage(activation.researchLineage);
    if (lineage.candidateId !== candidateId || activation.binding.candidateId !== candidateId) throw new Error("closed learning canonical period Research lineage conflicts with candidate provenance");
    return lineage;
  }

  private latestLineageWindow(): { readonly lineage: PaperResearchLineage; readonly periods: readonly PersistedPaperPeriodEnvelope[] } | undefined {
    const periods = ordered(this.options.periods.listRealizedPeriods());
    if (periods.length === 0) return undefined;
    const latest = periods[periods.length - 1]!;
    const lineage = this.lineageFor(latest);
    const selected = periods.filter((period) => {
      if (period.record.market?.trim().toUpperCase() !== latest.record.market?.trim().toUpperCase()) return false;
      if (period.candidateProvenance.length !== 1 || period.candidateProvenance[0]!.candidateId.trim() !== lineage.candidateId) return false;
      let historical: PaperResearchLineage;
      try { historical = this.lineageFor(period); } catch { return false; }
      return samePaperResearchLineage(historical, lineage);
    });
    if (selected.length === 0 || selected[selected.length - 1]!.record.recordId !== latest.record.recordId) throw new Error("closed learning canonical Research lineage window is incomplete");
    return Object.freeze({ lineage, periods: Object.freeze(selected) });
  }

  public evaluate(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchDecision {
    const window = this.latestLineageWindow();
    const decisionId = `${input.cycleId}:research`;
    if (window == null) return Object.freeze({ decisionId, outcome: "INSUFFICIENT", decisionReference: `${input.cycleId}:no-paper`, reasons: Object.freeze(["CANONICAL_PAPER_EVIDENCE_REQUIRED"]) });
    const account = this.options.readCanonicalPaperAccount();
    if (account == null) throw new Error("closed learning canonical PAPER account is unavailable");
    const replay = this.options.worker.replayCanonicalPaperEvidence({
      originalRunFingerprintSha256: window.lineage.originalRunFingerprintSha256,
      persistedPaperPeriods: window.periods,
      paperAccount: account,
      executionQualityPolicy: this.options.executionQualityPolicy,
    });
    const observedAt = this.now();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("closed learning Research history clock is invalid");
    this.options.history.persist(replay, observedAt);
    const preparation = replay.canonicalPreparation;
    if (preparation == null) throw new Error("closed learning canonical Research replay preparation is unavailable");
    const deployable = preparation.deploymentCandidate;
    if (deployable != null) {
      const researchLineage: PaperResearchLineage = Object.freeze({
        schemaVersion: 1,
        candidateId: deployable.candidateId,
        candidateVersion: deployable.candidateVersion,
        originalRunFingerprintSha256: deployable.originalRunFingerprintSha256,
        replayRunFingerprintSha256: deployable.replayRunFingerprintSha256,
        researchDecisionReference: deployable.decisionReference,
        authority: "PAPER_RESEARCH_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
      validatePaperResearchLineage(researchLineage);
      this.options.artifacts.save(Object.freeze({
        schemaVersion: 1,
        candidateId: deployable.candidateId,
        candidateVersion: deployable.candidateVersion,
        market: deployable.market,
        advisory: deployable.advisory,
        candidateProvenance: deployable.candidateProvenance,
        researchDecisionReference: deployable.decisionReference,
        researchLineage,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      }));
      return Object.freeze({
        decisionId,
        outcome: "QUALIFIED_FOR_LEAGUE",
        candidateId: deployable.candidateId,
        candidateVersion: deployable.candidateVersion,
        decisionReference: deployable.decisionReference,
        reasons: Object.freeze(["CANONICAL_PAPER_RESEARCH_REPLAY_QUALIFIED"]),
      });
    }
    const allRejected = replay.qualification.candidates.length > 0 && replay.qualification.candidates.every((candidate) => candidate.outcome === "REJECTED");
    const reasons = uniqueReasons([
      preparation.deploymentBlockedReason ?? "CANONICAL_PAPER_RESEARCH_REPLAY_NOT_DEPLOYABLE",
      ...replay.qualification.candidates.flatMap((candidate) => candidate.reasons.map((reason) => `${candidate.candidateId}:${reason}`)),
    ]);
    return Object.freeze({
      decisionId,
      outcome: allRejected ? "REJECTED" : "INSUFFICIENT",
      decisionReference: `research-replay:${replay.replayRunFingerprintSha256}`,
      reasons: reasons.length > 0 ? reasons : Object.freeze([allRejected ? "RESEARCH_FACTORY_REJECTED" : "RESEARCH_FACTORY_INSUFFICIENT"]),
    });
  }
}
