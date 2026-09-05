import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { adaptPersistedPaperForwardEvidence } from "../../../packages/contracts/src/persistedPaperForwardEvidenceAdapter";
import type { PaperForwardEvidenceAdmissionPolicy } from "../../../packages/contracts/src/paperForwardEvidenceAdmission";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperPerformanceSummary } from "../../../packages/contracts/src/strategyGovernance";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import type { ClosedLearningEvidenceSource } from "./closedLearningProductionScheduler";
import type { ClosedLearningResearchReplayInput, ClosedLearningResearchReplayInputSource } from "./closedLearningProductionResearchAdapter";
import type { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { samePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";

export interface ClosedLearningLineagePaperEvidenceSourceOptions {
  readonly listPaperRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly bindings: Pick<PaperChallengerBindingLedger, "lineage">;
  readonly performance: { read(candidateId: string): PaperPerformanceSummary | undefined };
  readonly champion: () => { readonly championId: string; readonly championVersion: string };
  readonly sourceCommitSha: string;
  readonly costModelVersion: string;
  readonly riskConfigHash: string;
  readonly admissionPolicy?: PaperForwardEvidenceAdmissionPolicy;
}

interface ResolvedCohort {
  readonly lineage: PaperResearchLineage;
  readonly market: string;
  readonly periods: readonly PersistedPaperPeriodEnvelope[];
  readonly admission: ReturnType<typeof adaptPersistedPaperForwardEvidence>["candidates"][number]["admission"];
  readonly paperPerformance: PaperPerformanceSummary;
  readonly identity: ClosedLearningEvidenceIdentity;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

function marketOf(period: PersistedPaperPeriodEnvelope): string {
  const market = period.record.market?.trim().toUpperCase() ?? "";
  if (!MARKET.test(market)) throw new Error("lineage-bound PAPER evidence requires canonical market provenance");
  return market;
}

function ordered(periods: readonly PersistedPaperPeriodEnvelope[]): readonly PersistedPaperPeriodEnvelope[] {
  const result = [...periods].sort((left, right) => left.record.periodStartAt - right.record.periodStartAt || left.record.periodIndex - right.record.periodIndex || left.record.recordId.localeCompare(right.record.recordId));
  const recordIds = new Set<string>();
  const periodIndices = new Set<number>();
  for (const period of result) {
    if (recordIds.has(period.record.recordId) || periodIndices.has(period.record.periodIndex)) throw new Error("lineage-bound PAPER evidence chronology is ambiguous");
    recordIds.add(period.record.recordId);
    periodIndices.add(period.record.periodIndex);
  }
  return Object.freeze(result);
}

/**
 * Read-only bridge from authoritative realized PAPER periods to the exact immutable Research run
 * that deployed the active challenger. It never selects a candidate, invents performance, filters
 * losing/failed periods, or grants execution authority.
 */
export class ClosedLearningLineagePaperEvidenceSource implements ClosedLearningEvidenceSource, ClosedLearningResearchReplayInputSource {
  private readonly sourceCommitSha: string;
  private readonly costModelVersion: string;
  private readonly riskConfigHash: string;

  public constructor(private readonly options: ClosedLearningLineagePaperEvidenceSourceOptions) {
    this.sourceCommitSha = text(options.sourceCommitSha, "sourceCommitSha").toLowerCase();
    this.costModelVersion = text(options.costModelVersion, "costModelVersion");
    this.riskConfigHash = text(options.riskConfigHash, "riskConfigHash").toLowerCase();
    if (!SHA40.test(this.sourceCommitSha) || !SHA256.test(this.riskConfigHash)) throw new Error("lineage-bound PAPER evidence provenance hashes are invalid");
  }

  private resolveCohort(): ResolvedCohort | undefined {
    const periods = ordered(this.options.listPaperRealizedPeriods());
    if (periods.length === 0) return undefined;
    const latest = periods.at(-1)!;
    const latestMarket = marketOf(latest);
    const latestLineage = this.options.bindings.lineage(latestMarket, latest.record.periodStartAt);
    if (latestLineage == null) return undefined;

    let start = periods.length - 1;
    while (start > 0) {
      const previous = periods[start - 1]!;
      const previousMarket = marketOf(previous);
      const previousLineage = this.options.bindings.lineage(previousMarket, previous.record.periodStartAt);
      if (previousMarket !== latestMarket || previousLineage == null || !samePaperResearchLineage(previousLineage, latestLineage)) break;
      start -= 1;
    }
    for (let index = 0; index < start; index += 1) {
      const historical = periods[index]!;
      const historicalMarket = marketOf(historical);
      const historicalLineage = this.options.bindings.lineage(historicalMarket, historical.record.periodStartAt);
      if (historicalMarket === latestMarket && historicalLineage != null && samePaperResearchLineage(historicalLineage, latestLineage)) {
        throw new Error("lineage-bound PAPER evidence cohort is non-contiguous");
      }
    }

    const cohort = Object.freeze(periods.slice(start));
    const adapted = adaptPersistedPaperForwardEvidence(cohort, this.options.admissionPolicy);
    if (adapted.candidates.length !== 1) throw new Error("automatic PAPER lineage cohort must contain exactly one candidate");
    const candidate = adapted.candidates[0]!;
    if (candidate.candidateId !== latestLineage.candidateId) throw new Error("PAPER evidence candidate does not match Research lineage");
    const paperPerformance = this.options.performance.read(candidate.candidateId);
    if (paperPerformance == null) return undefined;

    const champion = this.options.champion();
    const championId = text(champion.championId, "championId");
    const championVersion = text(champion.championVersion, "championVersion");
    const evidenceFingerprintSha256 = hash({
      schemaVersion: 1,
      market: latestMarket,
      lineage: latestLineage,
      periods: cohort,
      admission: candidate.admission,
      paperPerformance,
      championId,
      championVersion,
      sourceCommitSha: this.sourceCommitSha,
      costModelVersion: this.costModelVersion,
      riskConfigHash: this.riskConfigHash,
    });
    const evidenceReferences = Object.freeze([
      ...cohort.map((period) => `paper-period:${period.record.recordId}`),
      `research-run:${latestLineage.originalRunFingerprintSha256}`,
      `research-replay:${latestLineage.replayRunFingerprintSha256}`,
    ]);
    const identity = Object.freeze({
      evidenceId: `paper-forward-lineage:${evidenceFingerprintSha256}`,
      evidenceFingerprintSha256,
      championId,
      championVersion,
      sourceCommitSha: this.sourceCommitSha,
      costModelVersion: this.costModelVersion,
      riskConfigHash: this.riskConfigHash,
      evidenceReferences,
    });
    return Object.freeze({ lineage: latestLineage, market: latestMarket, periods: cohort, admission: candidate.admission, paperPerformance, identity });
  }

  public read(): ClosedLearningEvidenceIdentity | undefined {
    return this.resolveCohort()?.identity;
  }

  public resolve(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchReplayInput {
    const cohort = this.resolveCohort();
    if (cohort == null) throw new Error("lineage-bound PAPER replay evidence is unavailable");
    if (input.evidenceId !== cohort.identity.evidenceId || input.evidenceFingerprintSha256 !== cohort.identity.evidenceFingerprintSha256) throw new Error("lineage-bound PAPER replay identity changed before Research evaluation");
    return Object.freeze({
      originalRunFingerprintSha256: cohort.lineage.originalRunFingerprintSha256,
      paperEvidenceByCandidate: Object.freeze({
        [cohort.lineage.candidateId]: Object.freeze({ admission: cohort.admission, paperPerformance: cohort.paperPerformance }),
      }),
    });
  }
}
