import {
  comparePaperCalibrationEvidence,
  type PaperCalibrationAdmissionBinding,
  type PaperCalibrationObservation,
} from "./evolvePaperCalibrationEvidence";

export type StrategyLifecycleState =
  | "CANDIDATE"
  | "WATCH"
  | "PROMOTED"
  | "DEMOTED"
  | "QUARANTINED"
  | "RETIRED";

const VALID_LIFECYCLE_STATES = new Set<StrategyLifecycleState>([
  "CANDIDATE",
  "WATCH",
  "PROMOTED",
  "DEMOTED",
  "QUARANTINED",
  "RETIRED",
]);

export function validateStrategyLifecycleState(value: unknown): StrategyLifecycleState {
  if (typeof value !== "string" || !VALID_LIFECYCLE_STATES.has(value as StrategyLifecycleState)) {
    throw new Error("STRATEGY_LIFECYCLE_STATE_INVALID");
  }
  return value as StrategyLifecycleState;
}

export interface StrategyCalibrationContainmentInput {
  readonly currentState: StrategyLifecycleState;
  /**
   * Raw PAPER observations are projected through the existing canonical calibration comparator.
   * Callers cannot assert VERIFIED/REGRESSION/independence directly at this boundary.
   */
  readonly calibration?: {
    readonly baseline: {
      readonly admission: PaperCalibrationAdmissionBinding;
      readonly observations: readonly PaperCalibrationObservation[];
    };
    readonly candidate: {
      readonly admission: PaperCalibrationAdmissionBinding;
      readonly observations: readonly PaperCalibrationObservation[];
    };
    readonly currentConfidence: number;
    readonly requestedConfidence: number;
  };
}

export interface StrategyLifecycleDecision {
  readonly previousState: StrategyLifecycleState;
  readonly nextState: StrategyLifecycleState;
  readonly reason:
    | "retired-is-absorbing"
    | "canonical-calibration-evidence-missing"
    | "canonical-calibration-insufficient"
    | "canonical-calibration-regression"
    | "canonical-calibration-improved-no-promotion";
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

function failClosedState(currentState: StrategyLifecycleState): StrategyLifecycleState {
  if (currentState === "PROMOTED") return "DEMOTED";
  if (currentState === "CANDIDATE") return "WATCH";
  return currentState;
}

function decision(
  previousState: StrategyLifecycleState,
  nextState: StrategyLifecycleState,
  reason: StrategyLifecycleDecision["reason"],
): StrategyLifecycleDecision {
  return Object.freeze({ previousState, nextState, reason, authority: AUTHORITY });
}

/**
 * Small containment projection for #880 that reuses the canonical PAPER calibration evidence
 * boundary. It intentionally implements only the calibration slice: drawdown, regime, edge,
 * cost, provenance and repeated-failure retirement remain INSUFFICIENT until they have their own
 * repository-controlled trusted evidence bindings.
 *
 * This function cannot promote a strategy, create a queue/scheduler, execute trades, mutate
 * production, or manufacture evidence status. VERIFIED_IMPROVEMENT only preserves the current
 * state; insufficient calibration demotes a promoted strategy fail-closed.
 */
export function decideStrategyCalibrationContainment(
  input: StrategyCalibrationContainmentInput,
): StrategyLifecycleDecision {
  const current = validateStrategyLifecycleState(input.currentState);
  if (current === "RETIRED") return decision(current, "RETIRED", "retired-is-absorbing");

  if (input.calibration == null) {
    return decision(current, failClosedState(current), "canonical-calibration-evidence-missing");
  }

  const comparison = comparePaperCalibrationEvidence(input.calibration);
  if (comparison.status === "INSUFFICIENT") {
    return decision(current, failClosedState(current), "canonical-calibration-insufficient");
  }
  if (comparison.status === "REGRESSION") {
    return decision(current, current === "PROMOTED" ? "DEMOTED" : failClosedState(current), "canonical-calibration-regression");
  }

  return decision(current, current, "canonical-calibration-improved-no-promotion");
}
