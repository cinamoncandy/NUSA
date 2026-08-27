import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

/**
 * Failure attribution for a League candidate's realized outcome.
 *
 * Self-learning is not parameter tuning: it requires decomposing why a candidate underperformed,
 * so the right corrective action (re-verify / re-train / demote / retire / search elsewhere) can
 * be chosen instead of reacting to a single blended score. This module reads an existing League
 * standing -- it computes no new metric and runs no new backtest, regime, PAPER, or search engine
 * -- and classifies each candidate's evidence into the failure categories a self-learning loop
 * needs to distinguish:
 *
 *   DATA_FAILURE / REGIME_ERROR / SIGNAL_FAILURE / STRATEGY_DECAY / CALIBRATION_ERROR /
 *   RISK_ERROR / EXECUTION_COST / INFRASTRUCTURE_FAILURE
 *
 * Every category is tri-state: attributed (the evidence shows this failure mode), not attributed
 * (the evidence rules it out), or insufficient evidence (the category's underlying evidence field
 * is simply absent). A missing field is never silently read as "no failure" -- that would let a
 * candidate look clean by carrying less evidence, which is the opposite of what this is for.
 *
 * Purely diagnostic: this does not feed back into League scoring, promotion, or allocation, so it
 * cannot become a circular justification for the very evidence it reads. It grants no promotion,
 * demotion, retirement, capital, order, broker, or LIVE authority -- output is composed research
 * evidence for a human or a downstream research process to act on.
 */

export type CandidateFailureCategory =
  | "DATA_FAILURE"
  | "REGIME_ERROR"
  | "SIGNAL_FAILURE"
  | "STRATEGY_DECAY"
  | "CALIBRATION_ERROR"
  | "RISK_ERROR"
  | "EXECUTION_COST"
  | "INFRASTRUCTURE_FAILURE";

const ALL_CATEGORIES: readonly CandidateFailureCategory[] = Object.freeze([
  "DATA_FAILURE", "REGIME_ERROR", "SIGNAL_FAILURE", "STRATEGY_DECAY",
  "CALIBRATION_ERROR", "RISK_ERROR", "EXECUTION_COST", "INFRASTRUCTURE_FAILURE",
]);

export interface CandidateFailureAttributionPolicy {
  /** Drawdown above which RISK_ERROR is attributed. */
  readonly maximumAcceptableDrawdown: number;
  /** Benchmark excess at or below which SIGNAL_FAILURE is attributed -- the backtest itself never beat the benchmark. */
  readonly minimumBenchmarkExcess: number;
  /** Real PAPER return this far below the backtest counts as STRATEGY_DECAY. */
  readonly significantPaperDivergence: number;
  /** Fraction of the raw OOS return that cost-aware execution may consume before EXECUTION_COST is attributed. */
  readonly significantCostErosion: number;
  /** Deflated-Sharpe probability at or above which a candidate is "high statistical confidence" for CALIBRATION_ERROR purposes. */
  readonly calibrationConfidenceThreshold: number;
}

export interface CandidateFailureAttribution {
  readonly candidateId: string;
  readonly familyId: string;
  /** Failure modes the evidence actually shows. Empty means no attributed failure, not "healthy" by assumption. */
  readonly categories: readonly CandidateFailureCategory[];
  /** Categories that could not be evaluated because their underlying evidence is absent. */
  readonly insufficientEvidenceFor: readonly CandidateFailureCategory[];
  readonly reasons: readonly string[];
}

export class CandidateFailureAttributionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CandidateFailureAttributionError";
  }
}

const DEFAULT_POLICY: CandidateFailureAttributionPolicy = Object.freeze({
  maximumAcceptableDrawdown: 0.10,
  minimumBenchmarkExcess: 0,
  significantPaperDivergence: 0.02,
  significantCostErosion: 0.5,
  calibrationConfidenceThreshold: 0.95,
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const sortedUnique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)].sort());

function validatePolicy(policy: CandidateFailureAttributionPolicy): void {
  if (!Number.isFinite(policy.maximumAcceptableDrawdown) || policy.maximumAcceptableDrawdown <= 0) {
    throw new CandidateFailureAttributionError("INVALID_POLICY", "maximumAcceptableDrawdown must be finite and positive");
  }
  if (!Number.isFinite(policy.minimumBenchmarkExcess)) {
    throw new CandidateFailureAttributionError("INVALID_POLICY", "minimumBenchmarkExcess must be finite");
  }
  if (!Number.isFinite(policy.significantPaperDivergence) || policy.significantPaperDivergence <= 0) {
    throw new CandidateFailureAttributionError("INVALID_POLICY", "significantPaperDivergence must be finite and positive");
  }
  if (!Number.isFinite(policy.significantCostErosion) || policy.significantCostErosion <= 0 || policy.significantCostErosion > 1) {
    throw new CandidateFailureAttributionError("INVALID_POLICY", "significantCostErosion must be finite and within (0, 1]");
  }
  if (!Number.isFinite(policy.calibrationConfidenceThreshold) || policy.calibrationConfidenceThreshold <= 0 || policy.calibrationConfidenceThreshold > 1) {
    throw new CandidateFailureAttributionError("INVALID_POLICY", "calibrationConfidenceThreshold must be finite and within (0, 1]");
  }
}

function attributeOne(entry: LeagueRankedEntry, policy: CandidateFailureAttributionPolicy): CandidateFailureAttribution {
  const components = entry.components;
  const categories: CandidateFailureCategory[] = [];
  const insufficient: CandidateFailureCategory[] = [];
  const reasons: string[] = [];

  // DATA_FAILURE: provenance is mandatory in League's own construction, but re-checked here
  // defensively rather than assumed -- an attribution module must never trust silently.
  if (entry.sourceDatasetIds.length === 0) {
    categories.push("DATA_FAILURE");
    reasons.push("DATA_FAILURE_MISSING_PROVENANCE");
  }

  // REGIME_ERROR: a real edge that collapses outside the regime it was found in.
  if (components.regimeRobustnessClass == null) {
    insufficient.push("REGIME_ERROR");
    reasons.push("REGIME_ERROR_NO_REGIME_EVALUATION");
  } else if (components.regimeRobustnessClass === "FRAGILE") {
    categories.push("REGIME_ERROR");
    reasons.push("REGIME_ERROR_FRAGILE_SINGLE_REGIME_EDGE");
  } else if (components.regimeRobustnessClass === "INSUFFICIENT") {
    insufficient.push("REGIME_ERROR");
    reasons.push("REGIME_ERROR_INSUFFICIENT_REGIME_COVERAGE");
  }

  // SIGNAL_FAILURE: the backtest-derived edge never beat its own benchmark. Always evaluable --
  // benchmarkExcess is mandatory League evidence.
  if (components.benchmarkExcess <= policy.minimumBenchmarkExcess) {
    categories.push("SIGNAL_FAILURE");
    reasons.push("SIGNAL_FAILURE_NO_BENCHMARK_EXCESS");
  }

  // STRATEGY_DECAY: the edge that existed in the backtest did not survive real forward observation.
  if (components.paperBacktestDivergence == null) {
    insufficient.push("STRATEGY_DECAY");
    reasons.push("STRATEGY_DECAY_NO_PAPER_FORWARD_EVIDENCE");
  } else if (components.paperBacktestDivergence > policy.significantPaperDivergence) {
    categories.push("STRATEGY_DECAY");
    reasons.push("STRATEGY_DECAY_PAPER_BELOW_BACKTEST");
  }

  // CALIBRATION_ERROR: statistical confidence was high, yet the real outcome missed it by more
  // than a normal candidate's noise -- the confidence estimate itself was the miscalibrated part.
  if (components.riskAdjusted == null || components.paperBacktestDivergence == null) {
    insufficient.push("CALIBRATION_ERROR");
    reasons.push("CALIBRATION_ERROR_INSUFFICIENT_EVIDENCE");
  } else if (
    components.riskAdjusted >= policy.calibrationConfidenceThreshold
    && components.paperBacktestDivergence > policy.significantPaperDivergence
  ) {
    categories.push("CALIBRATION_ERROR");
    reasons.push("CALIBRATION_ERROR_HIGH_CONFIDENCE_FAILED_TO_PREDICT_OUTCOME");
  }

  // RISK_ERROR: capital-preservation evidence, not upside evidence. maximumDrawdown is mandatory;
  // counterfactual regret adds evidence when present but is never required to answer this.
  const drawdownBreach = components.maximumDrawdown > policy.maximumAcceptableDrawdown;
  const regretObserved = components.counterfactualRegret != null && components.counterfactualRegret > 0;
  if (drawdownBreach || regretObserved) {
    categories.push("RISK_ERROR");
    if (drawdownBreach) reasons.push("RISK_ERROR_EXCESSIVE_DRAWDOWN");
    if (regretObserved) reasons.push("RISK_ERROR_COUNTERFACTUAL_REGRET_OBSERVED");
  }

  // EXECUTION_COST: only meaningful when there was a positive raw edge for cost to erode.
  if (components.outOfSamplePerformance > 0) {
    if (components.costAdjustedGhostReturn == null) {
      insufficient.push("EXECUTION_COST");
      reasons.push("EXECUTION_COST_NO_GHOST_EXECUTION_EVIDENCE");
    } else if (components.costAdjustedGhostReturn <= components.outOfSamplePerformance * (1 - policy.significantCostErosion)) {
      categories.push("EXECUTION_COST");
      reasons.push("EXECUTION_COST_EDGE_CONSUMED_BY_REALISTIC_COSTS");
    }
  }

  // INFRASTRUCTURE_FAILURE: real operational faults, kill-switch activations, or sub-target
  // availability -- capital-preservation signals, not a performance judgment.
  if (components.paperReliabilityPenalty == null) {
    insufficient.push("INFRASTRUCTURE_FAILURE");
    reasons.push("INFRASTRUCTURE_FAILURE_NO_PAPER_RELIABILITY_EVIDENCE");
  } else if (components.paperReliabilityPenalty > 0) {
    categories.push("INFRASTRUCTURE_FAILURE");
    reasons.push("INFRASTRUCTURE_FAILURE_UNRESOLVED_OPERATIONAL_RISK");
  }

  return freeze({
    candidateId: entry.id,
    familyId: entry.familyId,
    categories: sortedUnique(categories) as readonly CandidateFailureCategory[],
    insufficientEvidenceFor: sortedUnique(insufficient) as readonly CandidateFailureCategory[],
    reasons: sortedUnique(reasons),
  });
}

/**
 * Attributes each League candidate's evidence to the failure categories a self-learning loop
 * needs to tell apart. Reads an existing League standing only -- no new metric, backtest, regime,
 * PAPER, or search evidence is computed, and the result feeds no scoring, promotion, demotion, or
 * capital-allocation path. Diagnostic research output only.
 */
export function attributeCandidateFailures(
  standing: LeagueStanding,
  policy: Partial<CandidateFailureAttributionPolicy> = {},
): readonly CandidateFailureAttribution[] {
  if (standing.schemaVersion !== 1) {
    throw new CandidateFailureAttributionError("UNSUPPORTED_LEAGUE_SCHEMA", "League standing schema is unsupported");
  }
  const resolvedPolicy: CandidateFailureAttributionPolicy = freeze({ ...DEFAULT_POLICY, ...policy });
  validatePolicy(resolvedPolicy);

  return freeze(standing.entries.map((entry) => attributeOne(entry, resolvedPolicy)));
}

export const CANDIDATE_FAILURE_CATEGORIES: readonly CandidateFailureCategory[] = ALL_CATEGORIES;
