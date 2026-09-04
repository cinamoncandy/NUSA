import type { PersistedPaperPeriodEnvelope } from "../../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperForwardEvidenceAdmissionPolicy } from "./paperForwardEvidenceAdmission";
import { adaptPersistedPaperForwardEvidence } from "./persistedPaperForwardEvidenceAdapter";
import type { ResearchRunCandidate } from "./researchRunLeagueBridge";

export interface ResearchPaperEvidenceBridgeResult {
  readonly candidates: readonly ResearchRunCandidate[];
  readonly matchedCandidateIds: readonly string[];
  readonly unmatchedPaperCandidateIds: readonly string[];
  readonly orderedRecordIds: readonly string[];
}

/**
 * Thin adapter that joins authoritative persisted PAPER periods to the existing ResearchRunCandidate
 * contract consumed by `buildResearchRunLeague`. It computes no performance metric and performs no
 * filtering of failed/insufficient PAPER evidence; the existing persisted adapter and League gate
 * remain the sole admission authorities.
 */
export function attachPersistedPaperForwardEvidence(
  candidates: readonly ResearchRunCandidate[],
  periods: readonly PersistedPaperPeriodEnvelope[],
  policy?: PaperForwardEvidenceAdmissionPolicy,
): ResearchPaperEvidenceBridgeResult {
  if (candidates.length === 0) throw new Error("research PAPER evidence bridge requires candidates");
  if (periods.length === 0) return Object.freeze({ candidates: Object.freeze([...candidates]), matchedCandidateIds: Object.freeze([]), unmatchedPaperCandidateIds: Object.freeze([]), orderedRecordIds: Object.freeze([]) });

  const adapted = adaptPersistedPaperForwardEvidence(periods, policy);
  const byCandidate = new Map(adapted.candidates.map((candidate) => [candidate.candidateId, candidate] as const));
  const matched: string[] = [];
  const projected = candidates.map((candidate) => {
    const evidence = byCandidate.get(candidate.id);
    if (evidence == null) return candidate;
    if (candidate.experiment.manifest.datasetId !== evidence.datasetId || candidate.experiment.manifest.contentSha256 !== evidence.datasetContentSha256) {
      throw new Error(`research PAPER evidence provenance mismatch for ${candidate.id}`);
    }
    matched.push(candidate.id);
    return Object.freeze({ ...candidate, paperForwardEvidence: evidence });
  });
  const unmatchedPaperCandidateIds = adapted.candidates.map((candidate) => candidate.candidateId).filter((candidateId) => !matched.includes(candidateId)).sort();
  return Object.freeze({
    candidates: Object.freeze(projected),
    matchedCandidateIds: Object.freeze([...matched].sort()),
    unmatchedPaperCandidateIds: Object.freeze(unmatchedPaperCandidateIds),
    orderedRecordIds: adapted.orderedRecordIds,
  });
}
