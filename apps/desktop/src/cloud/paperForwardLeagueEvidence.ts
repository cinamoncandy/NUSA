import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import type { PaperForwardEvidenceAdmission } from "./paperForwardEvidenceAdmission";

export interface PaperForwardLeagueEvidenceSource {
  readonly admission: PaperForwardEvidenceAdmission;
  /**
   * Existing canonical PAPER performance shape. The gate does not trust this object by presence:
   * every League-scoring field that can be checked against admission is reconciled fail-closed.
   */
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
const RETURN_TOLERANCE = 1e-12;

/**
 * Final fail-closed gate before longitudinal PAPER evidence may enter League's existing
 * `paperPerformance` slot. Identity is checked against the benchmark candidate's immutable
 * dataset provenance. INSufficient evidence stays visible but never becomes score/evidence breadth.
 *
 * A VERIFIED admission alone is not enough to bless an unrelated performance summary. League's
 * positive PAPER return credit must equal the admission's cost-adjusted cumulative return, and the
 * summary must not claim better availability or fewer failure signals than the admitted period
 * denominator supports. This prevents a provenance-valid admission from being paired with a more
 * flattering, independently fabricated summary.
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

  const paper = source.paperPerformance;
  if (!Number.isFinite(paper.netReturn) || Math.abs(paper.netReturn - admission.cumulativeNetReturn) > RETURN_TOLERANCE) {
    throw new PaperForwardLeagueEvidenceError(
      "PAPER_NET_RETURN_MISMATCH",
      "PAPER performance netReturn must equal the admitted cost-adjusted cumulative return",
    );
  }
  if (admission.periodCount < 1 || admission.completedPeriodCount < 0 || admission.completedPeriodCount > admission.periodCount) {
    throw new PaperForwardLeagueEvidenceError("INVALID_PAPER_ADMISSION_COUNTS", "PAPER admission period counts are inconsistent");
  }
  const maximumSupportedAvailability = admission.completedPeriodCount / admission.periodCount;
  if (!Number.isFinite(paper.availabilityRatio) || paper.availabilityRatio > maximumSupportedAvailability + RETURN_TOLERANCE) {
    throw new PaperForwardLeagueEvidenceError(
      "PAPER_AVAILABILITY_OVERCLAIM",
      "PAPER performance availability exceeds the admitted completed-period ratio",
    );
  }
  if (!Number.isSafeInteger(paper.unresolvedFaultCount) || !Number.isSafeInteger(paper.killSwitchActivationCount)
      || paper.unresolvedFaultCount < 0 || paper.killSwitchActivationCount < 0) {
    throw new PaperForwardLeagueEvidenceError("INVALID_PAPER_FAILURE_COUNTS", "PAPER failure counts must be non-negative safe integers");
  }
  if (paper.unresolvedFaultCount + paper.killSwitchActivationCount < admission.rejectedOrHaltedPeriodCount) {
    throw new PaperForwardLeagueEvidenceError(
      "PAPER_FAILURE_EVIDENCE_OMITTED",
      "PAPER performance summary omits rejected or halted forward-period risk evidence",
    );
  }

  reasons.push("VERIFIED_PAPER_FORWARD_EVIDENCE", "PAPER_PERFORMANCE_RECONCILED_TO_ADMISSION");
  return freeze({
    schemaVersion: 1,
    evidenceMode: "PAPER_SHADOW",
    strength: "VERIFIED",
    paperPerformance: freeze({ ...paper }),
    reasons: freeze(reasons.sort()),
  });
}
