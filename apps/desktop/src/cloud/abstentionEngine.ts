import type { RegimeHealthAssessment } from "./regimeHealth";

export type AbstentionDecision = "PROCEED_RESEARCH" | "ABSTAIN";

export interface AbstentionEvidence {
  readonly regime: RegimeHealthAssessment;
  readonly expectedEdge: number;
  readonly confidence: number;
  readonly estimatedRoundTripCost: number;
  readonly evidenceSampleCount: number;
  readonly stale: boolean;
}

export interface AbstentionThresholds {
  readonly minimumNetEdge: number;
  readonly minimumConfidence: number;
  readonly minimumEvidenceSampleCount: number;
  readonly mixedRegimeConfidencePremium: number;
}

export interface AbstentionAssessment {
  readonly schemaVersion: 1;
  readonly asOf: number;
  readonly decision: AbstentionDecision;
  readonly netExpectedEdge: number;
  readonly effectiveMinimumConfidence: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class AbstentionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AbstentionError";
  }
}

const DEFAULT_THRESHOLDS: AbstentionThresholds = Object.freeze({
  minimumNetEdge: 0.002,
  minimumConfidence: 0.6,
  minimumEvidenceSampleCount: 30,
  mixedRegimeConfidencePremium: 0.1,
});

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new AbstentionError(code, message);
}

function validateEvidence(evidence: AbstentionEvidence, thresholds: AbstentionThresholds): void {
  if (evidence.regime.schemaVersion !== 1) throw new AbstentionError("UNSUPPORTED_REGIME_SCHEMA", "regime health schema is unsupported");
  if (!Number.isInteger(evidence.evidenceSampleCount) || evidence.evidenceSampleCount < 0) {
    throw new AbstentionError("INVALID_SAMPLE_COUNT", "evidenceSampleCount must be a non-negative integer");
  }
  for (const [name, value] of [
    ["expectedEdge", evidence.expectedEdge],
    ["confidence", evidence.confidence],
    ["estimatedRoundTripCost", evidence.estimatedRoundTripCost],
  ] as const) assertFinite(value, "NON_FINITE_EVIDENCE", `${name} must be finite`);
  if (evidence.confidence < 0 || evidence.confidence > 1) throw new AbstentionError("INVALID_CONFIDENCE", "confidence must be between 0 and 1");
  if (evidence.estimatedRoundTripCost < 0) throw new AbstentionError("INVALID_COST", "estimatedRoundTripCost must be non-negative");
  if (thresholds.minimumNetEdge < 0 || thresholds.minimumConfidence < 0 || thresholds.minimumConfidence > 1 || thresholds.minimumEvidenceSampleCount < 1 || !Number.isInteger(thresholds.minimumEvidenceSampleCount) || thresholds.mixedRegimeConfidencePremium < 0) {
    throw new AbstentionError("INVALID_THRESHOLDS", "abstention thresholds are invalid");
  }
  if (thresholds.minimumConfidence + thresholds.mixedRegimeConfidencePremium > 1) {
    throw new AbstentionError("INVALID_THRESHOLDS", "mixed regime confidence threshold cannot exceed 1");
  }
}

export function assessAbstention(
  evidence: AbstentionEvidence,
  thresholds: AbstentionThresholds = DEFAULT_THRESHOLDS,
): AbstentionAssessment {
  validateEvidence(evidence, thresholds);

  const reasons: string[] = [];
  const netExpectedEdge = evidence.expectedEdge - evidence.estimatedRoundTripCost;
  const effectiveMinimumConfidence = thresholds.minimumConfidence + (evidence.regime.state === "MIXED" ? thresholds.mixedRegimeConfidencePremium : 0);

  if (evidence.stale) reasons.push("STALE_EVIDENCE");
  if (evidence.regime.state === "STRESSED") reasons.push("STRESSED_REGIME");
  if (netExpectedEdge < thresholds.minimumNetEdge) reasons.push("INSUFFICIENT_NET_EDGE");
  if (evidence.confidence < effectiveMinimumConfidence) reasons.push("INSUFFICIENT_CONFIDENCE");
  if (evidence.evidenceSampleCount < thresholds.minimumEvidenceSampleCount) reasons.push("INSUFFICIENT_SAMPLE_COUNT");

  const decision: AbstentionDecision = reasons.length === 0 ? "PROCEED_RESEARCH" : "ABSTAIN";

  return Object.freeze({
    schemaVersion: 1,
    asOf: evidence.regime.asOf,
    decision,
    netExpectedEdge,
    effectiveMinimumConfidence,
    reasons: Object.freeze(reasons),
    sourceDatasetIds: Object.freeze([...evidence.regime.sourceDatasetIds]),
  });
}
