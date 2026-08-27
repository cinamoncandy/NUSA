import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import type { PaperForwardEvidenceAdmission } from "./paperForwardEvidenceAdmission";

export interface PaperForwardLeagueEvidenceSource {
  readonly admission: PaperForwardEvidenceAdmission;
  readonly paperPerformance: PaperPerformanceSummary;
}

export interface PaperForwardLeagueEvidenceIdentity {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
}

export interface PaperForwardLeagueEvidenceDecision {
  readonly schemaVersion: 1;
  readonly evidenceMode: "PAPER_SHADOW";
  readonly strength: "INSUFFICIENT" | "VERIFIED";
  readonly paperPerformance?: PaperPerformanceSummary;
  readonly reasons: readonly string[];
}

export class PaperForwardLeagueEvidenceError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperForwardLeagueEvidenceError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Final fail-closed gate before longitudinal PAPER evidence may enter League's existing
 * `paperPerformance` slot. Identity is checked against the benchmark candidate's immutable
 * dataset provenance. INSufficient evidence stays visible but never becomes score/evidence breadth.
 */
export function gatePaperForwardLeagueEvidence(
  expected: PaperForwardLeagueEvidenceIdentity,
  source: PaperForwardLeagueEvidenceSource,
): PaperForwardLeagueEvidenceDecision {
  const admission = source.admission;
  if (admission.schemaVersion !== 1 || admission.evidenceMode !== "PAPER_SHADOW") {
    throw new PaperForwardLeagueEvidenceError("UNSUPPORTED_PAPER_EVIDENCE", "PAPER forward admission schema or mode is unsupported");
  }
  if (admission.candidateId !== expected.candidateId) {
    throw new PaperForwardLeagueEvidenceError("CANDIDATE_IDENTITY_MISMATCH", `PAPER candidate ${admission.candidateId} does not match ${expected.candidateId}`);
  }
  if (admission.datasetId !== expected.datasetId) {
    throw new PaperForwardLeagueEvidenceError("DATASET_IDENTITY_MISMATCH", `PAPER dataset ${admission.datasetId} does not match ${expected.datasetId}`);
  }
  if (admission.datasetContentSha256 !== expected.datasetContentSha256) {
    throw new PaperForwardLeagueEvidenceError("DATASET_CONTENT_MISMATCH", "PAPER dataset content hash does not match the benchmark candidate");
  }

  const reasons = ["PAPER_SHADOW_EVIDENCE_ONLY", "NO_EXECUTION_AUTHORITY"];
  if (admission.strength !== "VERIFIED") {
    reasons.push("PAPER_FORWARD_EVIDENCE_INSUFFICIENT");
    return freeze({
      schemaVersion: 1,
      evidenceMode: "PAPER_SHADOW",
      strength: "INSUFFICIENT",
      reasons: freeze(reasons.sort()),
    });
  }

  reasons.push("VERIFIED_PAPER_FORWARD_EVIDENCE");
  return freeze({
    schemaVersion: 1,
    evidenceMode: "PAPER_SHADOW",
    strength: "VERIFIED",
    paperPerformance: freeze({ ...source.paperPerformance }),
    reasons: freeze(reasons.sort()),
  });
}
