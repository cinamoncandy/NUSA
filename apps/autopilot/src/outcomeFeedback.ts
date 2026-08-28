import { evaluateOutcome } from "./outcomeEvaluator";
import type { OutcomeClassification, OutcomeConfidence } from "./outcomeEvaluator";

export type { OutcomeClassification, OutcomeConfidence } from "./outcomeEvaluator";

export type MetricDirection = "MAXIMIZE" | "MINIMIZE";

export interface OutcomeEvidence {
  readonly key: string;
  readonly metric: string;
  readonly direction: MetricDirection;
  readonly confidence: OutcomeConfidence;
  readonly baseline: number | null;
  readonly observed: number | null;
  readonly neutralTolerance: number;
  readonly source: string;
}

export interface OutcomeAssessment {
  readonly key: string;
  readonly metric: string;
  readonly classification: OutcomeClassification;
  readonly baseline: number | null;
  readonly observed: number | null;
  readonly delta: number | null;
  readonly reason: string;
  readonly recommendation: "KEEP" | "REWORK_OR_ROLLBACK" | "GATHER_MORE_EVIDENCE";
  readonly mutationAllowed: false;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

export function assessOutcome(evidence: OutcomeEvidence): OutcomeAssessment {
  const evaluation = evaluateOutcome({
    key: evidence.key,
    source: evidence.source,
    confidence: evidence.confidence,
    baseline: evidence.baseline,
    current: evidence.observed,
    direction: evidence.direction === "MAXIMIZE" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER",
    minimumMeaningfulDelta: evidence.neutralTolerance,
  });

  const delta = finite(evidence.baseline) && finite(evidence.observed)
    ? evidence.observed - evidence.baseline
    : null;
  const reason = {
    VERIFIED_IMPROVEMENT: "verified-post-change-improvement",
    NEUTRAL: "verified-change-within-neutral-tolerance",
    REGRESSION: "verified-post-change-regression",
    INSUFFICIENT: "insufficient-evidence-for-outcome-verification",
  }[evaluation.classification];

  return freeze({
    key: evidence.key,
    metric: evidence.metric,
    classification: evaluation.classification,
    baseline: evidence.baseline,
    observed: evidence.observed,
    delta,
    reason,
    recommendation: evaluation.recommendation === "GATHER_EVIDENCE"
      ? "GATHER_MORE_EVIDENCE"
      : evaluation.recommendation,
    mutationAllowed: false,
  });
}
