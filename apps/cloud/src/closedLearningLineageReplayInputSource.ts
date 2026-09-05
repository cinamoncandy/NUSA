import { adaptPersistedPaperForwardEvidence } from "../../desktop/src/cloud/persistedPaperForwardEvidenceAdapter";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { buildCanonicalPaperCandidatePerformance, type CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import type { ClosedLearningResearchReplayInput, ClosedLearningResearchReplayInputSource } from "./closedLearningProductionResearchAdapter";
import type { PaperChallengerBindingLedger, PaperChallengerActivationReceipt } from "./paperChallengerBindingLedger";
import type { PaperRealizedPeriodProducer } from "./paperRealizedPeriodProducer";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const PERIOD_REFERENCE_PREFIX = "paper-period:";
const MARKET = /^KRW-[A-Z0-9-]+$/;

export interface ClosedLearningLineageReplayInputSourceOptions {
  readonly periods: Pick<PaperRealizedPeriodProducer, "listRealizedPeriods">;
  readonly bindings: Pick<PaperChallengerBindingLedger, "current">;
  readonly readCanonicalPaperAccount: () => PaperAccountState | undefined;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
}

function referencedPeriodIds(references: readonly string[]): readonly string[] {
  const ids = references
    .filter((reference) => reference.startsWith(PERIOD_REFERENCE_PREFIX))
    .map((reference) => reference.slice(PERIOD_REFERENCE_PREFIX.length).trim());
  if (ids.length === 0 || ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("closed learning canonical PAPER period references are invalid");
  }
  return Object.freeze([...ids].sort());
}

function marketOf(period: PersistedPaperPeriodEnvelope): string {
  const market = period.record.market?.trim().toUpperCase() ?? "";
  if (!MARKET.test(market)) throw new Error("closed learning canonical PAPER period market is invalid");
  return market;
}

function candidateProvenanceFor(period: PersistedPaperPeriodEnvelope, candidateId: string) {
  const matches = period.candidateProvenance.filter((item) => item.candidateId.trim() === candidateId);
  if (matches.length !== 1) throw new Error("closed learning canonical PAPER candidate provenance is ambiguous");
  return matches[0]!;
}

function lineageAt(
  period: PersistedPaperPeriodEnvelope,
  bindings: Pick<PaperChallengerBindingLedger, "current">,
): { readonly lineage: PaperResearchLineage; readonly activation: PaperChallengerActivationReceipt } {
  const market = marketOf(period);
  const activation = bindings.current(market, period.record.periodStartAt);
  if (activation?.researchLineage == null) throw new Error("closed learning canonical PAPER Research lineage is unavailable");
  const lineage = validatePaperResearchLineage(activation.researchLineage);
  if (activation.binding.candidateId !== lineage.candidateId) throw new Error("closed learning PAPER binding conflicts with Research lineage");
  const provenance = candidateProvenanceFor(period, lineage.candidateId);
  if (
    provenance.datasetId !== activation.binding.datasetId
    || provenance.datasetContentSha256 !== activation.binding.datasetContentSha256
  ) throw new Error("closed learning PAPER period dataset provenance conflicts with active binding");
  return Object.freeze({ lineage, activation });
}

function selectedPeriods(
  realized: readonly PersistedPaperPeriodEnvelope[],
  references: readonly string[],
): readonly PersistedPaperPeriodEnvelope[] {
  const ids = referencedPeriodIds(references);
  const byId = new Map<string, PersistedPaperPeriodEnvelope>();
  for (const period of realized) {
    const id = period.record.recordId.trim();
    if (!id || byId.has(id)) throw new Error("closed learning canonical PAPER period identity is invalid or duplicated");
    byId.set(id, period);
  }
  const selected = ids.map((id) => byId.get(id) ?? (() => { throw new Error(`closed learning referenced PAPER period is unavailable: ${id}`); })());
  return Object.freeze(selected.sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.periodStartAt - right.record.periodStartAt || left.record.recordId.localeCompare(right.record.recordId)));
}

/**
 * Resolves one immutable Research replay input from the exact realized PAPER periods named by the
 * coordinator evidence identity. Period references are explicit (`paper-period:<recordId>`) so a
 * crash/retry cannot silently expand the denominator when newer PAPER periods arrive.
 *
 * Every selected period must resolve to the same durable PaperResearchLineage and the same active
 * candidate/dataset binding. Existing canonical persisted-period admission and canonical PAPER
 * performance derivation remain the only evidence/scoring implementations used here.
 */
export class ClosedLearningLineageReplayInputSource implements ClosedLearningResearchReplayInputSource {
  public constructor(private readonly options: ClosedLearningLineageReplayInputSourceOptions) {}

  public resolve(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchReplayInput {
    const periods = selectedPeriods(this.options.periods.listRealizedPeriods(), input.evidenceReferences);
    if (periods.length === 0) throw new Error("closed learning canonical PAPER evidence is unavailable");

    const first = lineageAt(periods[0]!, this.options.bindings);
    for (const period of periods.slice(1)) {
      const current = lineageAt(period, this.options.bindings);
      if (!samePaperResearchLineage(first.lineage, current.lineage)) throw new Error("closed learning PAPER periods span multiple Research lineages");
      if (current.activation.market !== first.activation.market) throw new Error("closed learning PAPER periods span multiple markets");
    }

    const adapted = adaptPersistedPaperForwardEvidence(periods);
    const account = this.options.readCanonicalPaperAccount();
    if (account == null || account.version !== 1) throw new Error("closed learning canonical PAPER account is unavailable");

    const paperEvidenceByCandidate: Record<string, unknown> = {};
    for (const candidate of adapted.candidates) {
      const paperPerformance = buildCanonicalPaperCandidatePerformance({
        candidateId: candidate.candidateId,
        periods: candidate.periods,
        account,
        executionQualityPolicy: this.options.executionQualityPolicy,
      });
      if (paperPerformance != null) {
        paperEvidenceByCandidate[candidate.candidateId] = Object.freeze({ admission: candidate.admission, paperPerformance });
      }
    }
    if (paperEvidenceByCandidate[first.lineage.candidateId] == null) {
      throw new Error("closed learning canonical PAPER performance is insufficient for the active Research lineage");
    }

    return Object.freeze({
      originalRunFingerprintSha256: first.lineage.originalRunFingerprintSha256,
      paperEvidenceByCandidate: Object.freeze(paperEvidenceByCandidate),
    });
  }
}

export function closedLearningPaperPeriodReference(recordId: string): string {
  const normalized = recordId.trim();
  if (!normalized) throw new Error("PAPER period recordId is required");
  return `${PERIOD_REFERENCE_PREFIX}${normalized}`;
}
