import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

/**
 * Evidence-weighted promotion research advisory.
 *
 * A League rank answers "which candidate looks best relative to the others". It deliberately does
 * NOT answer "is there enough independent evidence to promote this candidate at all" -- a rank of 1
 * in a weak field is still a rank of 1. This module answers the second question, and only that
 * question: it reads the evidence a League standing already carries and reports how strongly that
 * evidence supports promotion, with the specific blockers spelled out.
 *
 * Boundaries, deliberately:
 * - This is NOT the production promotion gate. `apps/cloud/src/researchPromotionGate.ts` and
 *   `strategyPromotionEngine.ts` own the real hard gate and the real thresholds; nothing here
 *   changes, relaxes, or substitutes for them. A ROBUST verdict here is an input for a human or a
 *   downstream research process, never a promotion.
 * - It grants no order, broker, sizing, capital, or LIVE authority, and produces no capital amount.
 * - It computes no new performance metric. Every value read here was produced by an existing
 *   evidence primitive and validated when the League standing was built.
 *
 * Evidence strength ladder (never skips a rung on the strength of returns alone):
 *   INSUFFICIENT -> NARROW -> SUPPORTIVE -> ROBUST
 *
 * Good performance cannot raise strength. Only evidence breadth, independence, OOS support,
 * regime robustness, and real forward PAPER evidence can. Any hard blocker pins the verdict at
 * INSUFFICIENT regardless of how good every other number looks -- a single average score must
 * never paper over a hard blocker.
 */

export type PromotionEvidenceStrength = "INSUFFICIENT" | "NARROW" | "SUPPORTIVE" | "ROBUST";

export interface PromotionEvidencePolicy {
  /** Minimum share of evidence categories a candidate must carry to clear NARROW. */
  readonly minimumEvidenceBreadth: number;
  /** Deflated-Sharpe probability at or above which search-adjusted risk evidence counts as supportive. */
  readonly minimumDeflatedSharpeProbability: number;
  /** Probability of backtest overfitting above which the whole league's evidence is not promotable. */
  readonly maximumProbabilityBacktestOverfitting: number;
  /** Minimum real PAPER observation days before forward evidence counts as more than anecdotal. */
  readonly minimumPaperObservationDays: number;
  /** Minimum real PAPER closed trades before forward evidence counts as more than anecdotal. */
  readonly minimumPaperTradeCount: number;
}

export interface PromotionEvidenceAssessment {
  readonly candidateId: string;
  readonly familyId: string;
  readonly strength: PromotionEvidenceStrength;
  /** Hard blockers. Any one of these pins strength at INSUFFICIENT. */
  readonly blockers: readonly string[];
  /** Non-blocking gaps that cap how far the strength can climb. */
  readonly gaps: readonly string[];
  /** Independent evidence pillars actually satisfied, by name -- never a single averaged score. */
  readonly satisfiedPillars: readonly string[];
  readonly evidenceBreadth: number;
  readonly sourceDatasetIds: readonly string[];
}

export interface PromotionEvidenceAdvisory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly policy: PromotionEvidencePolicy;
  readonly assessments: readonly PromotionEvidenceAssessment[];
  readonly promotableCandidateCount: number;
  readonly reasons: readonly string[];
}

export class PromotionEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PromotionEvidenceError";
  }
}

const DEFAULT_POLICY: PromotionEvidencePolicy = Object.freeze({
  minimumEvidenceBreadth: 0.6,
  minimumDeflatedSharpeProbability: 0.95,
  maximumProbabilityBacktestOverfitting: 0.5,
  minimumPaperObservationDays: 30,
  minimumPaperTradeCount: 50,
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const sortedUnique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)].sort());

function validatePolicy(policy: PromotionEvidencePolicy): void {
  for (const [field, value] of [
    ["minimumEvidenceBreadth", policy.minimumEvidenceBreadth],
    ["minimumDeflatedSharpeProbability", policy.minimumDeflatedSharpeProbability],
    ["maximumProbabilityBacktestOverfitting", policy.maximumProbabilityBacktestOverfitting],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new PromotionEvidenceError("INVALID_POLICY", `${field} must be finite and between 0 and 1`);
    }
  }
  for (const [field, value] of [
    ["minimumPaperObservationDays", policy.minimumPaperObservationDays],
    ["minimumPaperTradeCount", policy.minimumPaperTradeCount],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new PromotionEvidenceError("INVALID_POLICY", `${field} must be finite and non-negative`);
    }
  }
}

/**
 * Hard blockers. Each one means the evidence does not describe a promotable candidate at all,
 * independent of how strong the remaining numbers are.
 */
function collectBlockers(entry: LeagueRankedEntry, pbo: PboCscvEvidence | undefined, policy: PromotionEvidencePolicy): readonly string[] {
  const blockers: string[] = [];
  const components = entry.components;

  // League itself already judged this candidate not rankable on its own benchmark evidence.
  if (!entry.eligible) blockers.push("LEAGUE_INELIGIBLE");
  if (entry.leagueScore == null) blockers.push("NO_LEAGUE_SCORE");

  // An edge that only exists in one regime is a regime-selection artifact, not a promotable edge.
  if (components.regimeRobustnessClass === "FRAGILE") blockers.push("REGIME_FRAGILE_EDGE");

  // Real PAPER reliability failures are capital-preservation blockers, never averaged away.
  if (components.paperReliabilityPenalty != null && components.paperReliabilityPenalty > 0) {
    blockers.push("PAPER_RELIABILITY_RISK");
  }

  // Selection/multiple-testing risk across the whole search, not one candidate in isolation.
  if (pbo != null && pbo.probabilityBacktestOverfitting > policy.maximumProbabilityBacktestOverfitting) {
    blockers.push("PROBABILITY_BACKTEST_OVERFITTING_TOO_HIGH");
  }

  // Provenance must exist, or nothing above is attributable to real data.
  if (entry.sourceDatasetIds.length === 0) blockers.push("MISSING_PROVENANCE");

  return sortedUnique(blockers);
}

/**
 * Independent evidence pillars. Each must be satisfied on its own terms -- they are counted, never
 * averaged, so a very strong pillar cannot compensate for a missing one.
 */
function collectPillars(entry: LeagueRankedEntry, policy: PromotionEvidencePolicy): { readonly satisfied: readonly string[]; readonly gaps: readonly string[] } {
  const satisfied: string[] = [];
  const gaps: string[] = [];
  const components = entry.components;

  // 1. Out-of-sample edge over a real benchmark.
  if (components.outOfSamplePerformance > 0 && components.benchmarkExcess > 0) satisfied.push("OOS_BENCHMARK_EXCESS");
  else gaps.push("NO_OOS_BENCHMARK_EXCESS");

  // 2. Search-adjusted risk evidence (DSR).
  if (components.riskAdjusted == null) gaps.push("NO_DEFLATED_SHARPE_EVIDENCE");
  else if (components.riskAdjusted >= policy.minimumDeflatedSharpeProbability) satisfied.push("DEFLATED_SHARPE");
  else gaps.push("DEFLATED_SHARPE_BELOW_THRESHOLD");

  // 3. Multi-regime durability. Only a real ROBUST classification counts; INSUFFICIENT does not.
  if (components.regimeRobustnessClass === "ROBUST") satisfied.push("REGIME_ROBUSTNESS");
  else if (components.regimeRobustnessClass == null) gaps.push("NO_REGIME_EVALUATION");
  else gaps.push("INSUFFICIENT_REGIME_COVERAGE");

  // 4. Cost-aware simulated execution. An ABSTAIN is sound but is not promotion evidence.
  if (components.costAdjustedGhostReturn != null && components.costAdjustedGhostReturn > 0) satisfied.push("COST_ADJUSTED_EXECUTION");
  else gaps.push("NO_POSITIVE_COST_ADJUSTED_EXECUTION");

  // 5. Counterfactual: the decision actually taken was not clearly beaten by an alternative.
  if (components.counterfactualRegret == null) gaps.push("NO_COUNTERFACTUAL_EVIDENCE");
  else if (components.counterfactualRegret <= 0) satisfied.push("NO_COUNTERFACTUAL_REGRET");
  else gaps.push("COUNTERFACTUAL_REGRET_OBSERVED");

  // 6. Real forward PAPER evidence. Backtest agreement is required too: forward results that
  //    diverge below the backtest are a warning, not confirmation.
  if (components.paperNetReturn == null) gaps.push("NO_PAPER_FORWARD_EVIDENCE");
  else if (components.paperNetReturn > 0 && (components.paperBacktestDivergence ?? 0) <= 0) satisfied.push("PAPER_FORWARD_CONFIRMS_BACKTEST");
  else gaps.push("PAPER_FORWARD_DOES_NOT_CONFIRM_BACKTEST");

  return { satisfied: sortedUnique(satisfied), gaps: sortedUnique(gaps) };
}

function gradeStrength(
  blockers: readonly string[],
  satisfiedCount: number,
  evidenceBreadth: number,
  policy: PromotionEvidencePolicy,
): PromotionEvidenceStrength {
  // A hard blocker pins the verdict, whatever the rest of the evidence says.
  if (blockers.length > 0) return "INSUFFICIENT";
  // Breadth is a floor, not a score: too few evidence categories means we simply do not know.
  if (evidenceBreadth < policy.minimumEvidenceBreadth) return "NARROW";
  if (satisfiedCount >= 6) return "ROBUST";
  if (satisfiedCount >= 4) return "SUPPORTIVE";
  if (satisfiedCount >= 2) return "NARROW";
  return "INSUFFICIENT";
}

/**
 * Reads an existing League standing and reports, per candidate, how strongly the accumulated
 * evidence supports promotion. Research advisory only: it produces no capital amount, no order,
 * no broker call, and no LIVE authority, and it does not replace the production promotion gate.
 */
export function assessPromotionEvidence(
  standing: LeagueStanding,
  options: { readonly probabilityBacktestOverfitting?: PboCscvEvidence; readonly policy?: Partial<PromotionEvidencePolicy> } = {},
): PromotionEvidenceAdvisory {
  if (standing.schemaVersion !== 1) {
    throw new PromotionEvidenceError("UNSUPPORTED_LEAGUE_SCHEMA", "League standing schema is unsupported");
  }
  const policy: PromotionEvidencePolicy = freeze({ ...DEFAULT_POLICY, ...options.policy });
  validatePolicy(policy);

  const pbo = options.probabilityBacktestOverfitting;
  if (pbo != null && (pbo.probabilityBacktestOverfitting < 0 || pbo.probabilityBacktestOverfitting > 1)) {
    throw new PromotionEvidenceError("INVALID_PBO_EVIDENCE", "probabilityBacktestOverfitting must be between 0 and 1");
  }

  const assessments = standing.entries.map((entry) => {
    const blockers = collectBlockers(entry, pbo, policy);
    const { satisfied, gaps } = collectPillars(entry, policy);
    return freeze({
      candidateId: entry.id,
      familyId: entry.familyId,
      strength: gradeStrength(blockers, satisfied.length, entry.evidenceBreadth, policy),
      blockers,
      gaps,
      satisfiedPillars: satisfied,
      evidenceBreadth: entry.evidenceBreadth,
      sourceDatasetIds: entry.sourceDatasetIds,
    });
  });

  const reasons: string[] = ["RESEARCH_ADVISORY_ONLY", "NO_PROMOTION_AUTHORITY"];
  if (pbo == null) reasons.push("NO_SEARCH_OVERFITTING_EVIDENCE_SUPPLIED");
  if (assessments.every((assessment) => assessment.strength === "INSUFFICIENT")) reasons.push("NO_CANDIDATE_HAS_SUFFICIENT_EVIDENCE");

  return freeze({
    schemaVersion: 1,
    generatedAt: standing.generatedAt,
    policy,
    assessments: freeze(assessments),
    // Only ROBUST evidence is reported as promotable. SUPPORTIVE is explicitly not enough.
    promotableCandidateCount: assessments.filter((assessment) => assessment.strength === "ROBUST").length,
    reasons: sortedUnique(reasons),
  });
}
