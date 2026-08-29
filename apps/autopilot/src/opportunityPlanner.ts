export type EvidenceConfidence = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN";

export interface OpportunityEvidence {
  readonly key: string;
  readonly source: string;
  readonly confidence: EvidenceConfidence;
  readonly expectedValue: number | null;
  readonly riskReduction: number | null;
  readonly evidenceGain: number | null;
  readonly criticalPathUnlock: number | null;
  readonly effortCost: number | null;
  readonly uncertainty: number | null;
}

export interface ExistingWorkIdentity {
  readonly key: string;
}

export interface OpportunityCandidate {
  readonly key: string;
  readonly source: string;
  readonly score: number | null;
  readonly confidence: EvidenceConfidence;
  readonly reason: string;
  readonly mutationAllowed: false;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const validConfidence = (value: unknown): value is EvidenceConfidence =>
  value === "VERIFIED" || value === "INSUFFICIENT" || value === "UNKNOWN";
const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

function invalidEvidenceCandidate(evidence: OpportunityEvidence): OpportunityCandidate {
  return freeze({
    key: validText(evidence.key, 160) ? evidence.key.trim() : "unknown",
    source: validText(evidence.source, 256) ? evidence.source.trim() : "unknown",
    score: null,
    confidence: "UNKNOWN",
    reason: "invalid-evidence-input",
    mutationAllowed: false,
  });
}

export function planOpportunity(
  evidence: OpportunityEvidence,
  existingWork: readonly ExistingWorkIdentity[],
): OpportunityCandidate {
  if (!validText(evidence.key, 160) || !validText(evidence.source, 256) || !validConfidence(evidence.confidence)) {
    return invalidEvidenceCandidate(evidence);
  }
  const key = evidence.key.trim();
  const source = evidence.source.trim();
  if (existingWork.some((work) => typeof work.key === "string" && work.key.trim() === key)) {
    return freeze({
      key,
      source,
      score: null,
      confidence: evidence.confidence,
      reason: "deduplicated-existing-canonical-work",
      mutationAllowed: false,
    });
  }

  const components = [
    evidence.expectedValue,
    evidence.riskReduction,
    evidence.evidenceGain,
    evidence.criticalPathUnlock,
    evidence.effortCost,
    evidence.uncertainty,
  ];

  if (evidence.confidence !== "VERIFIED" || !components.every(finite)) {
    return freeze({
      key,
      source,
      score: null,
      confidence: evidence.confidence,
      reason: "insufficient-evidence-for-ranking",
      mutationAllowed: false,
    });
  }

  const score =
    evidence.expectedValue! +
    evidence.riskReduction! +
    evidence.evidenceGain! +
    evidence.criticalPathUnlock! -
    evidence.effortCost! -
    evidence.uncertainty!;

  return freeze({
    key,
    source,
    score,
    confidence: "VERIFIED",
    reason: "evidence-backed-advisory-ranking",
    mutationAllowed: false,
  });
}

export function rankOpportunities(candidates: readonly OpportunityCandidate[]): readonly OpportunityCandidate[] {
  return Object.freeze(
    [...candidates].sort((left, right) => {
      if (left.score === null && right.score === null) return left.key.localeCompare(right.key);
      if (left.score === null) return 1;
      if (right.score === null) return -1;
      if (right.score !== left.score) return right.score - left.score;
      return left.key.localeCompare(right.key);
    }),
  );
}
