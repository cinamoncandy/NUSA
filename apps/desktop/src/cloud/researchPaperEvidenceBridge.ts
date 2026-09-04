import type { PersistedPaperPeriodEnvelope } from "../../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import type { PaperForwardEvidenceAdmissionPolicy } from "./paperForwardEvidenceAdmission";
import { adaptPersistedPaperForwardEvidence } from "./persistedPaperForwardEvidenceAdapter";
import type { ResearchRunCandidate } from "./researchRunLeagueBridge";

export interface ResearchPaperEvidenceBridgeResult {
  readonly candidates: readonly ResearchRunCandidate[];
  readonly matchedCandidateIds: readonly string[];
  readonly awaitingPerformanceCandidateIds: readonly string[];
  readonly unmatchedPaperCandidateIds: readonly string[];
  readonly orderedRecordIds: readonly string[];
}

export interface ResearchPaperPerformanceSource {
  read(candidateId: string): PaperPerformanceSummary | undefined;
}

/**
 * Thin adapter that joins authoritative persisted PAPER periods to the existing ResearchRunCandidate
 * contract consumed by `buildResearchRunLeague`. Persisted periods intentionally do not contain every
 * `PaperPerformanceSummary` field (trade count / execution quality / fault counters), so this bridge
 * never derives or guesses those values. League evidence is attached only when a separate authoritative
 * performance source supplies the existing canonical summary. Insufficient/adverse period history remains
 * preserved by the persisted adapter regardless of whether the final League summary is ready yet.
 */
export function attachPersistedPaperForwardEvidence(
  candidates: readonly ResearchRunCandidate[],
  periods: readonly PersistedPaperPeriodEnvelope[],
  performance: ResearchPaperPerformanceSource,
  policy?: PaperForwardEvidenceAdmissionPolicy,
): ResearchPaperEvidenceBridgeResult {
  if (candidates.length === 0) throw new Error("research PAPER evidence bridge requires candidates");
  if (periods.length === 0) return Object.freeze({ candidates: Object.freeze([...candidates]), matchedCandidateIds: Object.freeze([]), awaitingPerformanceCandidateIds: Object.freeze([]), unmatchedPaperCandidateIds: Object.freeze([]), orderedRecordIds: Object.freeze([]) });

  const adapted = adaptPersistedPaperForwardEvidence(periods, policy);
  const byCandidate = new Map(adapted.candidates.map((candidate) => [candidate.candidateId, candidate] as const));
  const matched: string[] = [];
  const awaitingPerformance: string[] = [];
  const projected: ResearchRunCandidate[] = candidates.map((candidate): ResearchRunCandidate => {
    const evidence = byCandidate.get(candidate.id);
    if (evidence == null) return candidate;
    if (candidate.experiment.manifest.datasetId !== evidence.datasetId || candidate.experiment.manifest.contentSha256 !== evidence.datasetContentSha256) {
      throw new Error(`research PAPER evidence provenance mismatch for ${candidate.id}`);
    }
    const paperPerformance = performance.read(candidate.id);
    if (paperPerformance == null) {
      awaitingPerformance.push(candidate.id);
      return candidate;
    }
    matched.push(candidate.id);
    return Object.freeze({ ...candidate, paperForwardEvidence: Object.freeze({ admission: evidence.admission, paperPerformance: Object.freeze({ ...paperPerformance }) }) });
  });
  const knownResearchIds = new Set(candidates.map((candidate) => candidate.id));
  const unmatchedPaperCandidateIds = adapted.candidates.map((candidate) => candidate.candidateId).filter((candidateId) => !knownResearchIds.has(candidateId)).sort();
  return Object.freeze({
    candidates: Object.freeze(projected),
    matchedCandidateIds: Object.freeze([...matched].sort()),
    awaitingPerformanceCandidateIds: Object.freeze([...awaitingPerformance].sort()),
    unmatchedPaperCandidateIds: Object.freeze(unmatchedPaperCandidateIds),
    orderedRecordIds: adapted.orderedRecordIds,
  });
}
