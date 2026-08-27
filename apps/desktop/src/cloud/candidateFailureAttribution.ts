import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

/**
 * Failure attribution for a League candidate's realized outcome.
 *
 * This module only classifies evidence already present in a League standing. It computes no new
 * metric and runs no backtest, regime, PAPER, calibration, or search engine. Missing evidence is
 * represented explicitly so candidates cannot look healthier by carrying less evidence.
 *
 * Purely diagnostic: this does not feed back into League scoring, promotion, demotion, retirement,
 * allocation, capital, orders, broker access, or LIVE authority.
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
  "DATA_FAILURE",
  "REGIME_ERROR",
  "SIGNAL_FAILURE",
  "STRATEGY_DECAY",
  "CALIBRATION_ERROR",
  "RISK_ERROR",
  "EXECUTION_COST",
  "INFRASTRUCTURE_FAILURE",
]);

export interface CandidateFailureAttributionPolicy {
  readonly maximumAcceptableDrawdown: number;
  readonly minimumBenchmarkExcess: number;
  readonly significantPaperDivergence: number;
  readonly significantCostErosion: number;
}

export interface CandidateFailureAttribution {
  readonly candidateId: string;
  readonly familyId: string;
  readonly categories: readonly CandidateFailureCategory[];
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
}

function attributeOne(entry: LeagueRankedEntry, policy: CandidateFailureAttributionPolicy): CandidateFailureAttribution {
  const components = entry.components;
  const categories: CandidateFailureCategory[] = [];
  const insufficient: CandidateFailureCategory[] = [];
  const reasons: string[] = [];

  if (entry.sourceDatasetIds.length === 0) {
    categories.push("DATA_FAILURE");
    reasons.push("DATA_FAILURE_MISSING_PROVENANCE");
  }

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

  if (components.benchmarkExcess <= policy.minimumBenchmarkExcess) {
    categories.push("SIGNAL_FAILURE");
    reasons.push("SIGNAL_FAILURE_NO_BENCHMARK_EXCESS");
  }

  if (components.paperBacktestDivergence == null) {
    insufficient.push("STRATEGY_DECAY");
    reasons.push("STRATEGY_DECAY_NO_PAPER_FORWARD_EVIDENCE");
  } else if (components.paperBacktestDivergence > policy.significantPaperDivergence) {
    categories.push("STRATEGY_DECAY");
    reasons.push("STRATEGY_DECAY_PAPER_BELOW_BACKTEST");
  }

  // Deflated-Sharpe probability is search-adjusted statistical evidence, not a forecast
  // probability calibration score. A single PAPER/backtest miss likewise cannot establish
  // calibration error. Until the canonical path carries dedicated holdout calibration evidence
  // (for example reliability bins or a proper scoring diagnostic), fail closed rather than
  // fabricate a causal failure attribution.
  insufficient.push("CALIBRATION_ERROR");
  reasons.push("CALIBRATION_ERROR_NO_DEDICATED_CALIBRATION_EVIDENCE");

  const drawdownBreach = components.maximumDrawdown > policy.maximumAcceptableDrawdown;
  const regretObserved = components.counterfactualRegret != null && components.counterfactualRegret > 0;
  if (drawdownBreach || regretObserved) {
    categories.push("RISK_ERROR");
    if (drawdownBreach) reasons.push("RISK_ERROR_EXCESSIVE_DRAWDOWN");
    if (regretObserved) reasons.push("RISK_ERROR_COUNTERFACTUAL_REGRET_OBSERVED");
  }

  if (components.outOfSamplePerformance > 0) {
    if (components.costAdjustedGhostReturn == null) {
      insufficient.push("EXECUTION_COST");
      reasons.push("EXECUTION_COST_NO_GHOST_EXECUTION_EVIDENCE");
    } else if (components.costAdjustedGhostReturn <= components.outOfSamplePerformance * (1 - policy.significantCostErosion)) {
      categories.push("EXECUTION_COST");
      reasons.push("EXECUTION_COST_EDGE_CONSUMED_BY_REALISTIC_COSTS");
    }
  }

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
