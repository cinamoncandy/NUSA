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

export function planOpportunity(
  evidence: OpportunityEvidence,
  existingWork: readonly ExistingWorkIdentity[],
): OpportunityCandidate {
  if (existingWork.some((work) => work.key === evidence.key)) {
    return freeze({
      key: evidence.key,
      source: evidence.source,
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
      key: evidence.key,
      source: evidence.source,
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
    key: evidence.key,
    source: evidence.source,
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
