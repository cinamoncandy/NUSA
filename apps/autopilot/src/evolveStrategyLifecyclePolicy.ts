export type StrategyLifecycleState =
  | "CANDIDATE"
  | "WATCH"
  | "PROMOTED"
  | "DEMOTED"
  | "QUARANTINED"
  | "RETIRED";

export type StrategyEvidenceDimension =
  | "DRAWDOWN"
  | "CALIBRATION"
  | "REGIME"
  | "EDGE"
  | "COST"
  | "PROVENANCE"
  | "INFRASTRUCTURE";

export type StrategyEvidenceVerdict = "VERIFIED_HEALTHY" | "DETERIORATED" | "FAILED" | "INSUFFICIENT";

export interface StrategyLifecycleEvidence {
  readonly dimension: StrategyEvidenceDimension;
  readonly verdict: StrategyEvidenceVerdict;
  readonly fresh: boolean;
  /** True only when the evidence judge is independent from the strategy creator. */
  readonly independent: boolean;
}

export interface StrategyLifecycleInput {
  readonly currentState: StrategyLifecycleState;
  readonly evidence: readonly StrategyLifecycleEvidence[];
  /** Consecutive independently attributed strategy failures from canonical history. */
  readonly strategyFailureStreak: number;
}

export interface StrategyLifecycleDecision {
  readonly previousState: StrategyLifecycleState;
  readonly nextState: StrategyLifecycleState;
  readonly reason:
    | "retired-is-absorbing"
    | "evidence-missing"
    | "evidence-not-independent"
    | "evidence-stale-or-insufficient"
    | "evidence-conflicting"
    | "provenance-failure"
    | "infrastructure-failure"
    | "repeated-strategy-failure"
    | "strategy-failure"
    | "strategy-deterioration"
    | "verified-healthy-no-promotion";
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

const STRATEGY_DIMENSIONS = new Set<StrategyEvidenceDimension>([
  "DRAWDOWN",
  "CALIBRATION",
  "REGIME",
  "EDGE",
  "COST",
]);

function failClosedState(currentState: StrategyLifecycleState): StrategyLifecycleState {
  if (currentState === "PROMOTED") return "DEMOTED";
  if (currentState === "QUARANTINED" || currentState === "DEMOTED") return currentState;
  return "WATCH";
}

function decision(
  previousState: StrategyLifecycleState,
  nextState: StrategyLifecycleState,
  reason: StrategyLifecycleDecision["reason"],
): StrategyLifecycleDecision {
  return Object.freeze({ previousState, nextState, reason, authority: AUTHORITY });
}

function hasConflictingEvidence(evidence: readonly StrategyLifecycleEvidence[]): boolean {
  const verdictsByDimension = new Map<StrategyEvidenceDimension, Set<StrategyEvidenceVerdict>>();
  for (const item of evidence) {
    const verdicts = verdictsByDimension.get(item.dimension) ?? new Set<StrategyEvidenceVerdict>();
    verdicts.add(item.verdict);
    verdictsByDimension.set(item.dimension, verdicts);
  }

  for (const verdicts of verdictsByDimension.values()) {
    if (verdicts.has("VERIFIED_HEALTHY") && (verdicts.has("DETERIORATED") || verdicts.has("FAILED"))) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministic containment policy for the existing EVOLVE lifecycle.
 *
 * This function deliberately cannot promote a strategy, enqueue work, execute
 * trades, or mutate production. Promotion remains owned by the canonical
 * evidence/promotion boundary. This policy only preserves or reduces
 * eligibility when independent evidence deteriorates.
 */
export function decideStrategyLifecycle(input: StrategyLifecycleInput): StrategyLifecycleDecision {
  const current = input.currentState;
  if (current === "RETIRED") return decision(current, "RETIRED", "retired-is-absorbing");

  if (input.evidence.length === 0) {
    return decision(current, failClosedState(current), "evidence-missing");
  }

  if (input.evidence.some((item) => !item.independent)) {
    return decision(current, failClosedState(current), "evidence-not-independent");
  }

  if (input.evidence.some((item) => !item.fresh || item.verdict === "INSUFFICIENT")) {
    return decision(current, failClosedState(current), "evidence-stale-or-insufficient");
  }

  if (hasConflictingEvidence(input.evidence)) {
    return decision(current, "QUARANTINED", "evidence-conflicting");
  }

  if (input.evidence.some((item) => item.dimension === "PROVENANCE" && item.verdict === "FAILED")) {
    return decision(current, "QUARANTINED", "provenance-failure");
  }

  if (input.evidence.some((item) => item.dimension === "INFRASTRUCTURE" && item.verdict === "FAILED")) {
    return decision(current, "QUARANTINED", "infrastructure-failure");
  }

  const strategyFailure = input.evidence.some(
    (item) => STRATEGY_DIMENSIONS.has(item.dimension) && item.verdict === "FAILED",
  );
  if (strategyFailure) {
    if (input.strategyFailureStreak >= 3 && (current === "DEMOTED" || current === "QUARANTINED")) {
      return decision(current, "RETIRED", "repeated-strategy-failure");
    }
    return decision(current, "QUARANTINED", "strategy-failure");
  }

  const strategyDeterioration = input.evidence.some(
    (item) => STRATEGY_DIMENSIONS.has(item.dimension) && item.verdict === "DETERIORATED",
  );
  if (strategyDeterioration) {
    return decision(current, current === "PROMOTED" ? "DEMOTED" : failClosedState(current), "strategy-deterioration");
  }

  return decision(current, current, "verified-healthy-no-promotion");
}
