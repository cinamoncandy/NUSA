import { createHash } from "node:crypto";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { ResearchRunReplaySnapshotReader } from "../../desktop/src/cloud/researchRunReplaySnapshotStore";
import { validateResearchCandidateSpecification } from "../../desktop/src/cloud/researchCandidateSpecification";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { closedLearningPaperPeriodReference } from "./closedLearningLineageReplayInputSource";
import type { PaperChallengerBindingLedger, PaperChallengerActivationReceipt } from "./paperChallengerBindingLedger";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";

export interface ClosedLearningEvidenceIdentityWindow {
  readonly closedPeriod: PersistedPaperPeriodEnvelope;
  readonly realizedPeriods: readonly PersistedPaperPeriodEnvelope[];
}

export interface ClosedLearningEvidenceIdentitySourceOptions {
  readonly bindings: Pick<PaperChallengerBindingLedger, "current">;
  readonly replaySnapshots: ResearchRunReplaySnapshotReader;
  /** Exact fingerprint of the production PAPER risk policy that produced these periods. */
  readonly readRiskConfigHash: () => string;
}

const SHA64 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("closed-learning evidence identity contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  throw new Error("closed-learning evidence identity contains an unsupported value");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function marketOf(period: PersistedPaperPeriodEnvelope): string {
  const market = period.record.market?.trim().toUpperCase() ?? "";
  if (!MARKET.test(market)) throw new Error("closed-learning evidence period market is invalid");
  return market;
}

function activationFor(period: PersistedPaperPeriodEnvelope, bindings: Pick<PaperChallengerBindingLedger, "current">): PaperChallengerActivationReceipt {
  const activation = bindings.current(marketOf(period), period.record.periodStartAt);
  if (activation?.researchLineage == null) throw new Error("closed-learning evidence Research lineage is unavailable");
  return activation;
}

function lineageFor(period: PersistedPaperPeriodEnvelope, bindings: Pick<PaperChallengerBindingLedger, "current">): PaperResearchLineage {
  const activation = activationFor(period, bindings);
  const lineage = validatePaperResearchLineage(activation.researchLineage!);
  if (activation.binding.candidateId !== lineage.candidateId) throw new Error("closed-learning evidence binding conflicts with Research lineage");
  const provenance = period.candidateProvenance.filter((item) => item.candidateId === lineage.candidateId);
  if (provenance.length !== 1) throw new Error("closed-learning evidence candidate provenance is ambiguous");
  if (provenance[0]!.datasetId !== activation.binding.datasetId || provenance[0]!.datasetContentSha256 !== activation.binding.datasetContentSha256) {
    throw new Error("closed-learning evidence dataset provenance conflicts with PAPER binding");
  }
  return lineage;
}

function stablePeriods(periods: readonly PersistedPaperPeriodEnvelope[]): readonly PersistedPaperPeriodEnvelope[] {
  const ids = new Set<string>();
  const sorted = [...periods].sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.periodStartAt - right.record.periodStartAt || left.record.recordId.localeCompare(right.record.recordId));
  for (const period of sorted) {
    const id = period.record.recordId.trim();
    if (!id || ids.has(id)) throw new Error("closed-learning realized period identity is invalid or duplicated");
    ids.add(id);
  }
  return Object.freeze(sorted);
}

/**
 * Derives the coordinator evidence identity exclusively from durable canonical PAPER periods,
 * historical PAPER→Research binding lineage, the immutable original Research replay snapshot,
 * and the exact production risk-policy fingerprint. No source/cost/risk/champion identity can be
 * supplied by the scheduler or synthesized from wall-clock state.
 */
export class ClosedLearningEvidenceIdentitySource {
  public constructor(private readonly options: ClosedLearningEvidenceIdentitySourceOptions) {}

  public build(window: ClosedLearningEvidenceIdentityWindow): ClosedLearningEvidenceIdentity {
    const realized = stablePeriods(window.realizedPeriods);
    if (!realized.some((period) => period.record.recordId === window.closedPeriod.record.recordId)) {
      throw new Error("closed-learning just-closed period is missing from the realized denominator");
    }
    if (window.closedPeriod.record.status !== "COMPLETED") throw new Error("closed-learning evidence requires a completed PAPER period");

    const lineage = lineageFor(window.closedPeriod, this.options.bindings);
    const market = marketOf(window.closedPeriod);
    const selected = realized.filter((period) => {
      if (marketOf(period) !== market) return false;
      try {
        return samePaperResearchLineage(lineageFor(period, this.options.bindings), lineage);
      } catch {
        return false;
      }
    });
    if (selected.length === 0 || !selected.some((period) => period.record.recordId === window.closedPeriod.record.recordId)) {
      throw new Error("closed-learning same-lineage realized evidence window is unavailable");
    }

    const snapshot = this.options.replaySnapshots.read(lineage.originalRunFingerprintSha256);
    if (snapshot == null) throw new Error("closed-learning original Research replay snapshot is unavailable");
    if (snapshot.sourceCommitSha !== snapshot.sourceCommitSha.trim().toLowerCase()) throw new Error("closed-learning Research source commit is not canonical");
    const candidateMatches = snapshot.candidates.filter((candidate) => candidate.id === lineage.candidateId);
    if (candidateMatches.length !== 1) throw new Error("closed-learning Research snapshot candidate identity is ambiguous");
    const candidate = candidateMatches[0]!;
    const evaluationEnd = Date.parse(candidate.candidateSpecification.evaluationEndedAt);
    const specification = validateResearchCandidateSpecification(candidate.candidateSpecification, evaluationEnd);
    if (specification.status !== "VERIFIED" || specification.specificationHash !== lineage.candidateVersion) {
      throw new Error("closed-learning Research candidate version conflicts with PAPER lineage");
    }
    const sourceCommitSha = candidate.candidateSpecification.codeSha.trim().toLowerCase();
    if (sourceCommitSha !== snapshot.sourceCommitSha) throw new Error("closed-learning Research snapshot source commit drifted");
    const costModelVersion = candidate.candidateSpecification.costModelVersion.trim();
    if (!costModelVersion) throw new Error("closed-learning Research cost model identity is unavailable");

    const riskConfigHash = this.options.readRiskConfigHash().trim().toLowerCase();
    if (!SHA64.test(riskConfigHash)) throw new Error("closed-learning production risk fingerprint is invalid");

    const evidenceReferences = Object.freeze(selected.map((period) => closedLearningPaperPeriodReference(period.record.recordId)));
    const evidenceMaterial = Object.freeze({
      schemaVersion: 1,
      lineage,
      sourceCommitSha,
      costModelVersion,
      riskConfigHash,
      periods: selected.map((period) => Object.freeze({
        recordId: period.record.recordId,
        periodIndex: period.record.periodIndex,
        market: period.record.market,
        periodStartAt: period.record.periodStartAt,
        periodEndAt: period.record.periodEndAt,
        realizedReturns: period.record.realizedReturns,
        benchmarkReturn: period.record.benchmarkReturn,
        turnoverCostRate: period.record.turnoverCostRate,
        costEvidenceFingerprintSha256: period.record.costEvidence.evidenceFingerprintSha256,
        canonicalOutcomeReceiptFingerprint: period.record.canonicalOutcomeReceiptFingerprint ?? null,
        status: period.record.status,
        candidateProvenance: period.candidateProvenance,
      })),
    });
    const evidenceFingerprintSha256 = digest(evidenceMaterial);

    return Object.freeze({
      evidenceId: `closed-learning-paper:${evidenceFingerprintSha256}`,
      evidenceFingerprintSha256,
      championId: lineage.candidateId,
      championVersion: lineage.candidateVersion,
      sourceCommitSha,
      costModelVersion,
      riskConfigHash,
      evidenceReferences,
    });
  }
}
