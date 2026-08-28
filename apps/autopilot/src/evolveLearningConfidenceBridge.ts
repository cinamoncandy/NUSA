import type { EvolutionLearningRecord } from "./evolveLearningMemory";
import {
  guardEvolutionConfidence,
  type EvolutionConfidenceDecision,
  type EvolutionConfidenceEvidence,
  type EvolutionConfidenceOutcome,
} from "./evolveConfidenceGuard";

export interface EvolutionLearningConfidenceProjection {
  readonly opportunityId: string;
  readonly learningOutcome: EvolutionLearningRecord["outcome"];
  readonly confidenceOutcome: EvolutionConfidenceOutcome;
  readonly reusableForConfidenceIncrease: boolean;
  readonly decision: EvolutionConfidenceDecision;
}

function deriveConfidenceOutcome(record: EvolutionLearningRecord): EvolutionConfidenceOutcome {
  if (record.outcome === "REGRESSION") return "REGRESSION";
  if (record.outcome === "FAILED") return "FAILED";

  const verifiedImprovement =
    record.validationStatus === "VERIFIED_IMPROVEMENT" &&
    record.reusable &&
    (record.outcome === "SUCCESS" || record.outcome === "PARTIAL_SUCCESS");

  return verifiedImprovement ? "VERIFIED_IMPROVEMENT" : "INSUFFICIENT";
}

/**
 * Connects immutable Evolve learning memory to the bounded confidence guard.
 * A remembered success is not enough by itself: confidence can rise only when
 * the learning record is explicitly VERIFIED_IMPROVEMENT, marked reusable,
 * linked to the supplied evidence, and the existing confidence guard accepts
 * independent high-quality evidence. This projection grants no execution or LIVE authority.
 */
export function projectLearningMemoryToConfidence(input: {
  readonly record: EvolutionLearningRecord;
  readonly currentConfidence: number;
  readonly requestedConfidence: number;
  readonly evidence: readonly EvolutionConfidenceEvidence[];
}): EvolutionLearningConfidenceProjection {
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const missingReference = input.record.evidenceReferences.find((reference) => !evidenceIds.has(reference));
  if (missingReference) throw new Error("EVOLVE_LEARNING_CONFIDENCE_EVIDENCE_MISMATCH");

  const confidenceOutcome = deriveConfidenceOutcome(input.record);
  const decision = guardEvolutionConfidence({
    currentConfidence: input.currentConfidence,
    requestedConfidence: input.requestedConfidence,
    outcome: confidenceOutcome,
    evidence: input.evidence,
  });

  return Object.freeze({
    opportunityId: input.record.opportunityId,
    learningOutcome: input.record.outcome,
    confidenceOutcome,
    reusableForConfidenceIncrease: confidenceOutcome === "VERIFIED_IMPROVEMENT" && decision.increased,
    decision,
  });
}
