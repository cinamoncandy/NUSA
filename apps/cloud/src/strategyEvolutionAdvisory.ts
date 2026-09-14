import type { PaperOutcomeCalibrationResult } from "./paperOutcomeCalibration";

export type EvolutionLifecycleState = "CANDIDATE" | "WATCH" | "PROMOTED" | "DEMOTED" | "QUARANTINED" | "RETIRED";
export type EvolutionRecommendation = "PROMOTE" | "HOLD" | "DEMOTE" | "QUARANTINE" | "RETIRE";
export type EvolutionEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "STALE" | "CONFLICTING" | "FAILED";
export type LifecycleFailureEvidenceValidity = "CURRENT" | "SUPERSEDED" | "REVALIDATION_REQUIRED" | "CONFLICTING" | "UNKNOWN";

/**
 * Immutable evaluator semantics required for one failure to be comparable to a
 * lifecycle decision. Each component is deliberately explicit: a new execution
 * or warm-up contract must force revalidation instead of silently inheriting an
 * old negative result.
 */
export interface ComparableEvaluatorSemantics {
  readonly dataCostProvenanceId: string;
  readonly backtestExecutionSemanticsId: string;
  readonly walkForwardWarmupSemanticsId: string;
}

/** A sealed negative result. It is advisory evidence only, never lifecycle authority. */
export interface StrategyLifecycleFailureEvidence {
  readonly evidenceId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  /** One canonical search can contain many cells, but counts as at most one independent failure. */
  readonly canonicalSearchRunId: string;
  readonly evaluatorSemantics: ComparableEvaluatorSemantics | null;
  readonly validity: LifecycleFailureEvidenceValidity;
}

export interface StrategyEvolutionEvidence {
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly calibration: PaperOutcomeCalibrationResult;
  readonly regimeEvidence: EvolutionEvidenceStatus;
  readonly costEvidence: EvolutionEvidenceStatus;
  readonly drawdownEvidence: EvolutionEvidenceStatus;
  readonly provenanceEvidence: EvolutionEvidenceStatus;
  readonly infrastructureEvidence: EvolutionEvidenceStatus;
  readonly currentEvaluatorSemantics: ComparableEvaluatorSemantics;
  readonly repeatedFailureEvidence: readonly StrategyLifecycleFailureEvidence[];
  readonly structurallyDominated: boolean;
  readonly independentEvidenceCount: number;
  readonly minimumIndependentEvidenceForPromotion: number;
}

export interface StrategyEvolutionAdvisoryInput {
  readonly advisoryId: string;
  readonly currentState: EvolutionLifecycleState;
  readonly evidence: StrategyEvolutionEvidence;
}

export interface StrategyEvolutionLearningExplanation {
  readonly whatChanged: string;
  readonly why: string;
  readonly positiveEvidence: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly promotionBlocked: boolean;
  readonly summary: string;
}

export interface StrategyEvolutionAdvisoryResult {
  readonly advisoryId: string;
  readonly currentState: EvolutionLifecycleState;
  readonly recommendedState: EvolutionLifecycleState;
  readonly recommendation: EvolutionRecommendation;
  readonly reasons: readonly string[];
  readonly explanation: StrategyEvolutionLearningExplanation;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const freeze = <T>(value: T): T => Object.freeze(value);
const uncertain = new Set<EvolutionEvidenceStatus>(["INSUFFICIENT", "STALE", "CONFLICTING"]);

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validSemantics(value: ComparableEvaluatorSemantics | null): value is ComparableEvaluatorSemantics {
  return typeof value === "object" && value !== null
    && nonEmpty(value.dataCostProvenanceId)
    && nonEmpty(value.backtestExecutionSemanticsId)
    && nonEmpty(value.walkForwardWarmupSemanticsId);
}

function sameSemantics(left: ComparableEvaluatorSemantics, right: ComparableEvaluatorSemantics): boolean {
  return left.dataCostProvenanceId === right.dataCostProvenanceId
    && left.backtestExecutionSemanticsId === right.backtestExecutionSemanticsId
    && left.walkForwardWarmupSemanticsId === right.walkForwardWarmupSemanticsId;
}

interface ComparableFailureSummary {
  readonly count: number;
  readonly uncertain: boolean;
}

/**
 * A failure is independent only once per canonical search and only when it is
 * current, identity-bound, and evaluated under exactly the current semantics.
 * Legacy and malformed evidence remains historically preserved but cannot
 * influence a current lifecycle decision.
 */
function currentComparableFailures(evidence: StrategyEvolutionEvidence): ComparableFailureSummary {
  const searchIds = new Set<string>();
  let uncertainEvidence = false;
  for (const failure of evidence.repeatedFailureEvidence) {
    if (typeof failure !== "object" || failure === null) {
      uncertainEvidence = true;
      continue;
    }
    if (!nonEmpty(failure.evidenceId) || !nonEmpty(failure.candidateId) || !nonEmpty(failure.strategyFamilyId) || !nonEmpty(failure.canonicalSearchRunId)) {
      uncertainEvidence = true;
      continue;
    }
    if (failure.candidateId !== evidence.candidateId || failure.strategyFamilyId !== evidence.strategyFamilyId) {
      uncertainEvidence = true;
      continue;
    }
    if (failure.validity === "CONFLICTING" || failure.validity === "UNKNOWN" || !validSemantics(failure.evaluatorSemantics)) {
      uncertainEvidence = true;
      continue;
    }
    if (failure.validity !== "CURRENT" || !sameSemantics(failure.evaluatorSemantics, evidence.currentEvaluatorSemantics)) {
      uncertainEvidence = true;
      continue;
    }
    searchIds.add(failure.canonicalSearchRunId);
  }
  return freeze({ count: searchIds.size, uncertain: uncertainEvidence });
}

function validate(input: StrategyEvolutionAdvisoryInput): void {
  if (!input.advisoryId.trim() || !input.evidence.candidateId.trim() || !input.evidence.strategyFamilyId.trim() || !input.evidence.regime.trim()) {
    throw new Error("evolution advisory identity is required");
  }
  if (!validSemantics(input.evidence.currentEvaluatorSemantics)) throw new Error("current evaluator semantics are required");
  if (!Array.isArray(input.evidence.repeatedFailureEvidence)) throw new Error("repeated failure evidence must be an array");
  if (!Number.isSafeInteger(input.evidence.independentEvidenceCount) || input.evidence.independentEvidenceCount < 0) throw new Error("independentEvidenceCount must be a non-negative integer");
  if (!Number.isSafeInteger(input.evidence.minimumIndependentEvidenceForPromotion) || input.evidence.minimumIndependentEvidenceForPromotion <= 0) throw new Error("minimumIndependentEvidenceForPromotion must be positive");
  const calibration = input.evidence.calibration;
  if (calibration.candidateId !== input.evidence.candidateId || calibration.strategyFamilyId !== input.evidence.strategyFamilyId || calibration.regime !== input.evidence.regime) {
    throw new Error("calibration identity mismatch");
  }
  if (calibration.liveAuthority !== "NONE" || calibration.productionMutationAllowed !== false || calibration.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("calibration authority invariant failed");
  }
}

function recommendationState(current: EvolutionLifecycleState, recommendation: EvolutionRecommendation): EvolutionLifecycleState {
  if (recommendation === "RETIRE") return "RETIRED";
  if (recommendation === "QUARANTINE") return "QUARANTINED";
  if (recommendation === "DEMOTE") return "DEMOTED";
  if (recommendation === "PROMOTE") return "PROMOTED";
  return current;
}

const reasonText: Readonly<Record<string, string>> = Object.freeze({
  CALIBRATION_DETERIORATION: "calibration deteriorated",
  COST_EROSION: "modeled trading costs eroded the result",
  DRAWDOWN_DETERIORATION: "drawdown evidence deteriorated",
  EVIDENCE_UNCERTAIN_FAIL_CLOSED: "evidence is insufficient, stale, or conflicting",
  INDEPENDENT_VERIFIED_EVIDENCE_SUPPORTS_PROMOTION_RECOMMENDATION: "independent verified evidence supports a promotion recommendation",
  INFRASTRUCTURE_FAILURE: "infrastructure evidence failed",
  NO_EVIDENCE_BACKED_STATE_CHANGE: "no evidence-backed state change was found",
  PROVENANCE_FAILURE: "provenance evidence failed",
  REGIME_DEGRADATION: "regime evidence deteriorated",
  REPEATED_INDEPENDENT_FAILURES: "repeated independent failures were recorded",
  REPEATED_FAILURE_EVIDENCE_NOT_CURRENT: "repeated failure evidence is missing, conflicting, superseded, or not comparable to current evaluator semantics",
  RETIRED_IS_TERMINAL: "retirement is terminal",
  STRUCTURALLY_DOMINATED: "the candidate is structurally dominated",
});

function uniqueSorted(values: readonly string[]): readonly string[] {
  return freeze([...new Set(values)].sort());
}

function buildLearningExplanation(
  input: StrategyEvolutionAdvisoryInput,
  recommendation: EvolutionRecommendation,
  recommendedState: EvolutionLifecycleState,
  reasons: readonly string[],
): StrategyEvolutionLearningExplanation {
  const evidence = input.evidence;
  const statuses = [
    ["regime", evidence.regimeEvidence],
    ["cost", evidence.costEvidence],
    ["drawdown", evidence.drawdownEvidence],
    ["provenance", evidence.provenanceEvidence],
    ["infrastructure", evidence.infrastructureEvidence],
  ] as const;
  const positiveEvidence = statuses
    .filter(([, status]) => status === "VERIFIED")
    .map(([name]) => name + ":VERIFIED");
  if (evidence.calibration.decision === "CALIBRATED") positiveEvidence.push("calibration:CALIBRATED");
  if (evidence.independentEvidenceCount >= evidence.minimumIndependentEvidenceForPromotion) {
    positiveEvidence.push("independent-evidence:" + evidence.independentEvidenceCount + "/" + evidence.minimumIndependentEvidenceForPromotion);
  }

  const counterEvidence = statuses
    .filter(([, status]) => status === "FAILED" || status === "CONFLICTING")
    .map(([name, status]) => name + ":" + status);
  if (evidence.calibration.confidenceAction === "REDUCE") counterEvidence.push("calibration:REDUCE");
  const repeatedFailures = currentComparableFailures(evidence);
  if (repeatedFailures.count > 0) counterEvidence.push("repeated-failures:" + repeatedFailures.count);
  if (repeatedFailures.uncertain) counterEvidence.push("repeated-failures:NOT_CURRENT_OR_COMPARABLE");
  if (evidence.structurallyDominated) counterEvidence.push("structural-domination");

  const missingEvidence = statuses
    .filter(([, status]) => status === "INSUFFICIENT" || status === "STALE")
    .map(([name, status]) => name + ":" + status);
  if (evidence.calibration.decision !== "CALIBRATED") missingEvidence.push("calibration:CALIBRATED");
  if (evidence.independentEvidenceCount < evidence.minimumIndependentEvidenceForPromotion) {
    missingEvidence.push("independent-evidence:" + evidence.independentEvidenceCount + "/" + evidence.minimumIndependentEvidenceForPromotion);
  }

  const positive = uniqueSorted(positiveEvidence);
  const counter = uniqueSorted(counterEvidence);
  const missing = uniqueSorted(missingEvidence);
  const why = reasons.length === 0
    ? "no evidence-backed state change was found"
    : reasons.map((reason) => reasonText[reason] ?? "reason code " + reason).join("; ");
  const whatChanged = input.currentState === recommendedState
    ? "state remains " + input.currentState + "; recommendation=" + recommendation
    : "state changes " + input.currentState + " -> " + recommendedState + "; recommendation=" + recommendation;
  const list = (values: readonly string[]): string => values.length === 0 ? "none recorded" : values.join(", ");
  const summary = recommendation + " - " + whatChanged + ". Why: " + why
    + ". Positive evidence: " + list(positive)
    + ". Counter-evidence: " + list(counter)
    + ". Missing evidence: " + list(missing) + ".";

  return freeze({
    whatChanged,
    why,
    positiveEvidence: positive,
    counterEvidence: counter,
    missingEvidence: missing,
    promotionBlocked: recommendation !== "PROMOTE",
    summary,
  });
}

/** Advisory only. It cannot mutate lifecycle state, submit a promotion command, or grant authority. */
export function evaluateStrategyEvolutionAdvisory(input: StrategyEvolutionAdvisoryInput): StrategyEvolutionAdvisoryResult {
  validate(input);
  const evidence = input.evidence;
  const repeatedFailures = currentComparableFailures(evidence);
  const reasons: string[] = [];
  let recommendation: EvolutionRecommendation = "HOLD";

  if (input.currentState === "RETIRED") {
    reasons.push("RETIRED_IS_TERMINAL");
  } else if (repeatedFailures.uncertain) {
    reasons.push("REPEATED_FAILURE_EVIDENCE_NOT_CURRENT");
  } else if (evidence.structurallyDominated || repeatedFailures.count >= 3) {
    recommendation = "RETIRE";
    if (evidence.structurallyDominated) reasons.push("STRUCTURALLY_DOMINATED");
    if (repeatedFailures.count >= 3) reasons.push("REPEATED_INDEPENDENT_FAILURES");
  } else if (evidence.provenanceEvidence === "FAILED" || evidence.infrastructureEvidence === "FAILED") {
    recommendation = "QUARANTINE";
    if (evidence.provenanceEvidence === "FAILED") reasons.push("PROVENANCE_FAILURE");
    if (evidence.infrastructureEvidence === "FAILED") reasons.push("INFRASTRUCTURE_FAILURE");
  } else if ([evidence.regimeEvidence, evidence.costEvidence, evidence.drawdownEvidence, evidence.provenanceEvidence, evidence.infrastructureEvidence].some((status) => uncertain.has(status))) {
    recommendation = input.currentState === "PROMOTED" ? "DEMOTE" : "HOLD";
    reasons.push("EVIDENCE_UNCERTAIN_FAIL_CLOSED");
  } else if (evidence.regimeEvidence === "FAILED" || evidence.costEvidence === "FAILED" || evidence.drawdownEvidence === "FAILED" || evidence.calibration.confidenceAction === "REDUCE") {
    recommendation = input.currentState === "PROMOTED" ? "DEMOTE" : "HOLD";
    if (evidence.regimeEvidence === "FAILED") reasons.push("REGIME_DEGRADATION");
    if (evidence.costEvidence === "FAILED") reasons.push("COST_EROSION");
    if (evidence.drawdownEvidence === "FAILED") reasons.push("DRAWDOWN_DETERIORATION");
    if (evidence.calibration.confidenceAction === "REDUCE") reasons.push("CALIBRATION_DETERIORATION");
  } else if (
    evidence.calibration.decision === "CALIBRATED"
    && evidence.calibration.confidenceAction === "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE"
    && evidence.independentEvidenceCount >= evidence.minimumIndependentEvidenceForPromotion
    && input.currentState !== "PROMOTED"
    && input.currentState !== "QUARANTINED"
  ) {
    recommendation = "PROMOTE";
    reasons.push("INDEPENDENT_VERIFIED_EVIDENCE_SUPPORTS_PROMOTION_RECOMMENDATION");
  } else {
    reasons.push("NO_EVIDENCE_BACKED_STATE_CHANGE");
  }

  const recommendedState = recommendationState(input.currentState, recommendation);
  return freeze({
    advisoryId: input.advisoryId,
    currentState: input.currentState,
    recommendedState,
    recommendation,
    reasons: freeze([...new Set(reasons)].sort()),
    explanation: buildLearningExplanation(input, recommendation, recommendedState, freeze([...new Set(reasons)].sort())),
    candidateId: evidence.candidateId,
    strategyFamilyId: evidence.strategyFamilyId,
    regime: evidence.regime,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
