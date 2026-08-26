import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { DeflatedSharpeEvidence, PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";

/**
 * NUSA League: the research-only ranking layer over the existing evidence primitives
 * (Benchmark Scorecard, DSR/PBO, Regime Health, point-in-time regime-aware OOS robustness,
 * Abstention, Ghost Execution, Counterfactual, Trial Ledger, and real PAPER performance
 * evidence). It computes no new performance metric --
 * every number here is read directly from evidence those modules already produced -- and it
 * never gains order/broker/capital/LIVE authority. Its only output is a research ranking plus
 * the reasons behind it.
 *
 * PAPER evidence connects League's backtest-derived ranking to what a candidate actually did
 * once observed live in PAPER mode: real PnL/reliability either confirms or diverges from the
 * backtest, and unresolved faults or kill-switch activations are surfaced as risk, never hidden
 * or auto-resolved by League itself (the production strategy governance gate remains the only
 * place that can hard-disqualify a strategy on that evidence).
 *
 * Deliberately not a second research engine: this module owns composition and scoring only.
 */

export interface LeagueCandidateInput {
  readonly id: string;
  readonly familyId: string;
  /** Mandatory: every candidate must carry real OOS/benchmark/drawdown evidence to be ranked at all. */
  readonly benchmark: ResearchBenchmarkSliceScore;
  readonly deflatedSharpe?: DeflatedSharpeEvidence;
  readonly regime?: RegimeHealthAssessment;
  /**
   * Point-in-time OOS performance bucketed by regime (bull/mixed/stressed), when available --
   * a strictly stronger regime-robustness signal than the single current-market-state `regime`
   * snapshot, because it reflects how this candidate's own walk-forward windows actually behaved
   * under each regime rather than what regime the market happens to be in right now.
   */
  readonly regimeAwareEvaluation?: RegimeAwareStrategyEvaluation;
  readonly abstention?: AbstentionAssessment;
  readonly ghostExecution?: GhostExecutionResult;
  readonly counterfactual?: CounterfactualAssessment;
  readonly trialLedgerSummary?: ResearchTrialLedgerSummary;
  /**
   * The candidate's real PAPER execution track record (the same PaperPerformanceSummary the
   * production strategy governance gate already consumes) -- League treats this as confirming or
   * disconfirming evidence for the backtest, never as capital-allocation authority.
   */
  readonly paperPerformance?: PaperPerformanceSummary;
}

export interface LeaguePolicy {
  readonly probabilityBacktestOverfittingPenaltyWeight: number;
  /** Minimum multi-regime OOS robustness score at which an edge counts as ROBUST rather than FRAGILE. */
  readonly regimeRobustnessThreshold?: number;
  /** Fraction of backtest-derived return credit a FRAGILE (single-regime) edge is allowed to keep. */
  readonly fragileEvidenceDiscount?: number;
  /** Fraction of backtest-derived return credit kept while regime coverage is still INSUFFICIENT. */
  readonly insufficientRegimeEvidenceDiscount?: number;
}

/**
 * How much a candidate's headline OOS edge is actually supported by evidence across market
 * regimes. ROBUST: the edge held up in at least two regimes. FRAGILE: the edge exists in some
 * regimes and collapses in others -- a strong average return here is largely one regime's luck.
 * INSUFFICIENT: regime coverage is too thin to judge either way, which is never treated as
 * equivalent to robustness.
 */
export type RegimeRobustnessClass = "ROBUST" | "FRAGILE" | "INSUFFICIENT";

export interface LeagueCandidateComponents {
  readonly outOfSamplePerformance: number;
  readonly benchmarkExcess: number;
  readonly maximumDrawdown: number;
  readonly riskAdjusted?: number;
  readonly regimeRobustness?: number;
  readonly regimeRobustnessClass?: RegimeRobustnessClass;
  /** Fraction of backtest-derived return credit retained after the regime-evidence discount. */
  readonly regimeEvidenceDiscount?: number;
  readonly costAdjustedGhostReturn?: number;
  readonly abstentionQuality?: number;
  readonly counterfactualRegret?: number;
  readonly trialFailureRatio?: number;
  readonly paperNetReturn?: number;
  readonly paperBacktestDivergence?: number;
  readonly paperReliabilityPenalty?: number;
}

export interface LeagueRankedEntry {
  readonly id: string;
  readonly familyId: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly evidenceBreadth: number;
  readonly components: LeagueCandidateComponents;
  readonly leagueScore?: number;
  readonly rank?: number;
  readonly sourceDatasetIds: readonly string[];
}

export interface LeagueStanding {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly policy: Required<LeaguePolicy>;
  readonly probabilityBacktestOverfitting?: number;
  readonly entries: readonly LeagueRankedEntry[];
  readonly coverage: Readonly<{ candidateCount: number; eligibleCount: number; familyCount: number }>;
  readonly provenance: Readonly<{ sourceDatasetIds: readonly string[] }>;
}

export class NusaLeagueError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaLeagueError";
  }
}

const DEFAULT_POLICY: Required<LeaguePolicy> = Object.freeze({
  probabilityBacktestOverfittingPenaltyWeight: 200,
  regimeRobustnessThreshold: 0.5,
  fragileEvidenceDiscount: 0.25,
  insufficientRegimeEvidenceDiscount: 0.5,
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new NusaLeagueError(code, message);
}

/**
 * A candidate's own contextual evidence (regime/abstention/ghost/counterfactual) must actually
 * trace back to that candidate's own dataset, or the "evidence" is not evidence about this
 * candidate at all -- fail closed rather than silently score against unrelated provenance.
 */
function assertProvenanceCovers(datasetId: string, sourceDatasetIds: readonly string[], code: string, label: string): void {
  if (!sourceDatasetIds.includes(datasetId)) {
    throw new NusaLeagueError(code, `${label} provenance does not cover candidate dataset ${datasetId}`);
  }
}

function validateCandidate(candidate: LeagueCandidateInput): void {
  if (!candidate.id.trim()) throw new NusaLeagueError("INVALID_CANDIDATE_ID", "candidate id is required");
  if (!candidate.familyId.trim()) throw new NusaLeagueError("INVALID_FAMILY_ID", "candidate familyId is required");
  if (!candidate.benchmark.id.trim()) throw new NusaLeagueError("MISSING_BENCHMARK_EVIDENCE", `candidate ${candidate.id} requires benchmark scorecard evidence`);

  const datasetId = candidate.benchmark.datasetId;
  assertFinite(candidate.benchmark.totalReturn, "NON_FINITE_BENCHMARK_EVIDENCE", `candidate ${candidate.id} benchmark.totalReturn must be finite`);
  assertFinite(candidate.benchmark.maximumDrawdown, "NON_FINITE_BENCHMARK_EVIDENCE", `candidate ${candidate.id} benchmark.maximumDrawdown must be finite`);

  if (candidate.deflatedSharpe != null) {
    if (candidate.deflatedSharpe.selectedTrialId !== candidate.id) {
      throw new NusaLeagueError("DSR_IDENTITY_MISMATCH", `candidate ${candidate.id} deflatedSharpe.selectedTrialId does not match candidate id`);
    }
    assertFinite(candidate.deflatedSharpe.deflatedSharpeProbability, "NON_FINITE_DSR_EVIDENCE", `candidate ${candidate.id} deflatedSharpeProbability must be finite`);
  }
  if (candidate.regime != null) {
    if (candidate.regime.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_REGIME_SCHEMA", `candidate ${candidate.id} regime schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.regime.sourceDatasetIds, "REGIME_PROVENANCE_MISMATCH", `candidate ${candidate.id} regime`);
  }
  if (candidate.regimeAwareEvaluation != null) {
    const evaluation = candidate.regimeAwareEvaluation;
    if (evaluation.schemaVersion !== 1) {
      throw new NusaLeagueError("UNSUPPORTED_REGIME_AWARE_EVALUATION_SCHEMA", `candidate ${candidate.id} regime-aware evaluation schema is unsupported`);
    }
    assertProvenanceCovers(datasetId, evaluation.sourceDatasetIds, "REGIME_AWARE_EVALUATION_PROVENANCE_MISMATCH", `candidate ${candidate.id} regime-aware evaluation`);
    if (evaluation.datasetId !== datasetId) {
      throw new NusaLeagueError("REGIME_AWARE_EVALUATION_IDENTITY_MISMATCH", `candidate ${candidate.id} regime-aware evaluation does not describe this candidate's own dataset`);
    }
  }
  if (candidate.abstention != null) {
    if (candidate.abstention.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_ABSTENTION_SCHEMA", `candidate ${candidate.id} abstention schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.abstention.sourceDatasetIds, "ABSTENTION_PROVENANCE_MISMATCH", `candidate ${candidate.id} abstention`);
  }
  if (candidate.ghostExecution != null) {
    if (candidate.ghostExecution.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_GHOST_SCHEMA", `candidate ${candidate.id} ghost execution schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.ghostExecution.sourceDatasetIds, "GHOST_EXECUTION_PROVENANCE_MISMATCH", `candidate ${candidate.id} ghost execution`);
    if (candidate.ghostExecution.status === "SIMULATED") assertFinite(candidate.ghostExecution.netReturn!, "NON_FINITE_GHOST_EVIDENCE", `candidate ${candidate.id} ghost netReturn must be finite`);
    // Ghost execution's own status is derived from an abstention decision (simulateGhostExecution
    // only ever produces SIMULATED for PROCEED_RESEARCH and SKIPPED for ABSTAIN). If this candidate
    // also carries an abstention assessment, the two must agree, or one of the two evidence objects
    // does not actually describe this candidate's real decision -- fail closed rather than silently
    // scoring a self-contradictory record as if it were coherent.
    if (candidate.abstention != null) {
      const expectedStatus = candidate.abstention.decision === "PROCEED_RESEARCH" ? "SIMULATED" : "SKIPPED";
      if (candidate.ghostExecution.status !== expectedStatus) {
        throw new NusaLeagueError("GHOST_EXECUTION_ABSTENTION_MISMATCH", `candidate ${candidate.id} ghost execution status does not match its own abstention decision`);
      }
    }
  }
  if (candidate.counterfactual != null) {
    if (candidate.counterfactual.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_COUNTERFACTUAL_SCHEMA", `candidate ${candidate.id} counterfactual schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.counterfactual.sourceDatasetIds, "COUNTERFACTUAL_PROVENANCE_MISMATCH", `candidate ${candidate.id} counterfactual`);
    assertFinite(candidate.counterfactual.regret, "NON_FINITE_COUNTERFACTUAL_EVIDENCE", `candidate ${candidate.id} counterfactual regret must be finite`);
  }
  if (candidate.trialLedgerSummary != null) {
    const summary = candidate.trialLedgerSummary;
    if (!Number.isInteger(summary.trialCount) || summary.trialCount < 0) throw new NusaLeagueError("INVALID_TRIAL_LEDGER_EVIDENCE", `candidate ${candidate.id} trial ledger summary is invalid`);
    if (summary.completedCount + summary.failedCount + summary.rejectedCount > summary.trialCount) {
      throw new NusaLeagueError("INVALID_TRIAL_LEDGER_EVIDENCE", `candidate ${candidate.id} trial ledger outcome counts exceed trialCount`);
    }
  }
  if (candidate.paperPerformance != null) {
    const paper = candidate.paperPerformance;
    for (const [field, value] of Object.entries(paper)) {
      if (typeof value === "number" && !Number.isFinite(value)) throw new NusaLeagueError("NON_FINITE_PAPER_EVIDENCE", `candidate ${candidate.id} paperPerformance.${field} must be finite`);
    }
    if (paper.observationDays < 0 || paper.tradeCount < 0 || paper.unresolvedFaultCount < 0 || paper.killSwitchActivationCount < 0) {
      throw new NusaLeagueError("INVALID_PAPER_EVIDENCE", `candidate ${candidate.id} paperPerformance counts must be non-negative`);
    }
    if (paper.availabilityRatio < 0 || paper.availabilityRatio > 1) throw new NusaLeagueError("INVALID_PAPER_EVIDENCE", `candidate ${candidate.id} paperPerformance.availabilityRatio must be between 0 and 1`);
    if (paper.endedAt != null && paper.endedAt < paper.startedAt) throw new NusaLeagueError("INVALID_PAPER_EVIDENCE", `candidate ${candidate.id} paperPerformance.endedAt precedes startedAt`);
  }
}

function candidateProvenance(candidate: LeagueCandidateInput): readonly string[] {
  const ids = new Set<string>([candidate.benchmark.datasetId]);
  for (const id of candidate.regime?.sourceDatasetIds ?? []) ids.add(id);
  for (const id of candidate.regimeAwareEvaluation?.sourceDatasetIds ?? []) ids.add(id);
  for (const id of candidate.abstention?.sourceDatasetIds ?? []) ids.add(id);
  for (const id of candidate.ghostExecution?.sourceDatasetIds ?? []) ids.add(id);
  for (const id of candidate.counterfactual?.sourceDatasetIds ?? []) ids.add(id);
  return Object.freeze([...ids].sort());
}

/**
 * A sound ABSTAIN is a valid research outcome, not a failure -- it is only ever scored up
 * (never penalized below the neutral floor), while a PROCEED decision is scored by how far its
 * net expected edge actually cleared the abstention policy's minimum bar.
 */
function abstentionQuality(abstention: AbstentionAssessment): number {
  if (abstention.decision === "ABSTAIN") return 1;
  return clamp01(0.5 + abstention.netExpectedEdge * 50);
}

/**
 * Real PAPER faults, kill-switch activations, and sub-target availability are capital-preservation
 * signals -- League folds them into a single [0, 1] reliability penalty rather than a raw pass/fail,
 * because the actual production gate (strategyPromotionEngine) already owns the hard disqualification;
 * League only needs to make the risk visible in the ranking.
 */
function paperReliabilityPenalty(paper: PaperPerformanceSummary): number {
  const faultPenalty = clamp01(paper.unresolvedFaultCount / 3);
  const killSwitchPenalty = paper.killSwitchActivationCount > 0 ? 1 : 0;
  const availabilityPenalty = clamp01((0.99 - paper.availabilityRatio) / 0.1);
  return clamp01(Math.max(faultPenalty, killSwitchPenalty, availabilityPenalty));
}

/**
 * Classifies how well a candidate's edge is evidenced across regimes. Only the candidate's own
 * multi-regime OOS evaluation can establish ROBUST -- the single current-market-state snapshot
 * says nothing about durability, so a candidate carrying only that snapshot stays unclassified
 * rather than being credited with robustness it has not demonstrated.
 */
function classifyRegimeRobustness(candidate: LeagueCandidateInput, threshold: number): RegimeRobustnessClass | undefined {
  const evaluation = candidate.regimeAwareEvaluation;
  if (evaluation == null) return undefined;
  if (evaluation.regimeRobustnessScore == null || evaluation.sufficientRegimeCount < 2) return "INSUFFICIENT";
  return evaluation.regimeRobustnessScore >= threshold ? "ROBUST" : "FRAGILE";
}

function scoreCandidate(candidate: LeagueCandidateInput, policy: Required<LeaguePolicy>): LeagueRankedEntry {
  const reasons: string[] = [...candidate.benchmark.reasons];
  const eligible = candidate.benchmark.eligible;
  const trialFailureRatio = candidate.trialLedgerSummary != null && candidate.trialLedgerSummary.trialCount > 0
    ? (candidate.trialLedgerSummary.failedCount + candidate.trialLedgerSummary.rejectedCount) / candidate.trialLedgerSummary.trialCount
    : undefined;
  if (candidate.deflatedSharpe != null && !candidate.deflatedSharpe.passes) reasons.push("DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD");
  if (candidate.regime?.state === "STRESSED") reasons.push("STRESSED_REGIME_CONTEXT");
  if (candidate.regimeAwareEvaluation != null && candidate.regimeAwareEvaluation.regimeRobustnessScore == null) {
    reasons.push("NARROW_REGIME_ROBUSTNESS_EVIDENCE");
  }
  const robustnessClass = classifyRegimeRobustness(candidate, policy.regimeRobustnessThreshold);
  // A headline OOS return earned in one regime and given back in another is not evidence of a
  // durable edge, so it must not be allowed to buy a top League rank on size alone.
  const regimeEvidenceDiscount = robustnessClass === "FRAGILE"
    ? policy.fragileEvidenceDiscount
    : robustnessClass === "INSUFFICIENT" ? policy.insufficientRegimeEvidenceDiscount : 1;
  if (robustnessClass === "FRAGILE") reasons.push("REGIME_FRAGILE_EDGE");
  if (robustnessClass === "INSUFFICIENT") reasons.push("INSUFFICIENT_REGIME_COVERAGE");
  if (robustnessClass === "ROBUST") reasons.push("REGIME_ROBUST_EDGE");
  if (candidate.abstention?.decision === "ABSTAIN") reasons.push("ABSTAINED_SOUND_DECISION");
  if (candidate.ghostExecution?.status === "SKIPPED") reasons.push("GHOST_EXECUTION_SKIPPED_BY_ABSTENTION");
  if (candidate.counterfactual != null && candidate.counterfactual.regret > 0) reasons.push("COUNTERFACTUAL_REGRET_OBSERVED");
  if (candidate.paperPerformance != null && candidate.paperPerformance.netReturn < candidate.benchmark.totalReturn) reasons.push("PAPER_PERFORMANCE_BELOW_BACKTEST");
  if (candidate.paperPerformance?.unresolvedFaultCount) reasons.push("PAPER_UNRESOLVED_FAULT");
  if (candidate.paperPerformance?.killSwitchActivationCount) reasons.push("PAPER_KILL_SWITCH_ACTIVATED");

  const components: LeagueCandidateComponents = freeze({
    outOfSamplePerformance: candidate.benchmark.totalReturn,
    benchmarkExcess: candidate.benchmark.averageOutperformance,
    maximumDrawdown: candidate.benchmark.maximumDrawdown,
    ...(candidate.deflatedSharpe == null ? {} : { riskAdjusted: candidate.deflatedSharpe.deflatedSharpeProbability }),
    // Once a candidate carries real multi-regime OOS evaluation, that evidence -- not the single
    // current-market-state snapshot -- is authoritative for regimeRobustness. If that deeper
    // evaluation itself concluded there is not yet enough regime diversity/robustness evidence
    // (regimeRobustnessScore undefined), the component stays absent rather than quietly falling
    // back to the unrelated, weaker snapshot score -- narrow evidence must not be repackaged as
    // if it were robust.
    ...(candidate.regimeAwareEvaluation != null
      ? (candidate.regimeAwareEvaluation.regimeRobustnessScore == null
        ? {}
        : { regimeRobustness: candidate.regimeAwareEvaluation.regimeRobustnessScore })
      : candidate.regime == null ? {} : { regimeRobustness: candidate.regime.score }),
    ...(robustnessClass == null ? {} : { regimeRobustnessClass: robustnessClass, regimeEvidenceDiscount }),
    ...(candidate.ghostExecution?.status === "SIMULATED" ? { costAdjustedGhostReturn: candidate.ghostExecution.netReturn } : {}),
    ...(candidate.abstention == null ? {} : { abstentionQuality: abstentionQuality(candidate.abstention) }),
    ...(candidate.counterfactual == null ? {} : { counterfactualRegret: candidate.counterfactual.regret }),
    ...(trialFailureRatio == null ? {} : { trialFailureRatio }),
    ...(candidate.paperPerformance == null ? {} : {
      paperNetReturn: candidate.paperPerformance.netReturn,
      paperBacktestDivergence: candidate.benchmark.totalReturn - candidate.paperPerformance.netReturn,
      paperReliabilityPenalty: paperReliabilityPenalty(candidate.paperPerformance),
    }),
  });

  const evidenceCategories = [candidate.deflatedSharpe, candidate.regime, candidate.regimeAwareEvaluation, candidate.abstention, candidate.ghostExecution, candidate.counterfactual, candidate.trialLedgerSummary, candidate.paperPerformance];
  const evidenceBreadth = evidenceCategories.filter((value) => value != null).length / evidenceCategories.length;

  // Only the *backtest-derived* return credit is discounted by regime evidence, and only when it
  // is positive: a fragile edge must not be able to buy rank with a headline return, but a losing
  // candidate must never be rewarded by having its losses shrunk. Drawdown, reliability penalties,
  // regret, and real forward PAPER performance are deliberately left undiscounted -- they are
  // either risk that stands on its own or forward evidence that is not a regime-selection artifact.
  const backtestReturnCredit = components.outOfSamplePerformance * 1_000 + components.benchmarkExcess * 500;
  const discountedBacktestReturnCredit = backtestReturnCredit > 0
    ? backtestReturnCredit * regimeEvidenceDiscount
    : backtestReturnCredit;

  const leagueScore = eligible
    ? discountedBacktestReturnCredit
      - components.maximumDrawdown * 500
      + (components.riskAdjusted ?? 0) * 300
      + (components.regimeRobustness ?? 0.5) * 100
      + (components.costAdjustedGhostReturn ?? 0) * 400
      + (components.abstentionQuality ?? 0.5) * 100
      - (components.counterfactualRegret ?? 0) * 300
      - (components.trialFailureRatio ?? 0) * 50
      + (components.paperNetReturn ?? 0) * 400
      - Math.max(0, components.paperBacktestDivergence ?? 0) * 200
      - (components.paperReliabilityPenalty ?? 0) * 500
      + evidenceBreadth * 50
    : undefined;

  return freeze({
    id: candidate.id,
    familyId: candidate.familyId,
    eligible,
    reasons: freeze(reasons),
    evidenceBreadth,
    components,
    ...(leagueScore == null ? {} : { leagueScore }),
    sourceDatasetIds: candidateProvenance(candidate),
  });
}

/**
 * Composes the existing evidence primitives into one research-only ranking. Never produces an
 * order, broker call, capital allocation, or LIVE authority -- the output is ranking/evidence
 * only, for a human or downstream research process to read.
 */
export function evaluateLeague(
  candidates: readonly LeagueCandidateInput[],
  options: { readonly probabilityBacktestOverfitting?: PboCscvEvidence; readonly policy?: LeaguePolicy; readonly generatedAt?: string } = {},
): LeagueStanding {
  if (candidates.length === 0) throw new NusaLeagueError("EMPTY_LEAGUE", "league requires at least one candidate");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new NusaLeagueError("DUPLICATE_CANDIDATE_ID", `duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    validateCandidate(candidate);
  }

  const policy = freeze({ ...DEFAULT_POLICY, ...options.policy });
  if (!Number.isFinite(policy.probabilityBacktestOverfittingPenaltyWeight) || policy.probabilityBacktestOverfittingPenaltyWeight < 0) {
    throw new NusaLeagueError("INVALID_POLICY", "probabilityBacktestOverfittingPenaltyWeight must be finite and non-negative");
  }
  for (const [field, value] of [
    ["regimeRobustnessThreshold", policy.regimeRobustnessThreshold],
    ["fragileEvidenceDiscount", policy.fragileEvidenceDiscount],
    ["insufficientRegimeEvidenceDiscount", policy.insufficientRegimeEvidenceDiscount],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new NusaLeagueError("INVALID_POLICY", `${field} must be finite and between 0 and 1`);
    }
  }
  // A fragile edge must never be credited more generously than a merely under-evidenced one.
  if (policy.fragileEvidenceDiscount > policy.insufficientRegimeEvidenceDiscount) {
    throw new NusaLeagueError("INVALID_POLICY", "fragileEvidenceDiscount must not exceed insufficientRegimeEvidenceDiscount");
  }

  const pbo = options.probabilityBacktestOverfitting;
  if (pbo != null) {
    if (!Number.isInteger(pbo.strategyCount) || pbo.strategyCount < 2) throw new NusaLeagueError("INVALID_PBO_EVIDENCE", "league PBO evidence must cover at least two strategies");
    if (pbo.probabilityBacktestOverfitting < 0 || pbo.probabilityBacktestOverfitting > 1) throw new NusaLeagueError("INVALID_PBO_EVIDENCE", "probabilityBacktestOverfitting must be between 0 and 1");
  }

  const generatedAt = options.generatedAt ?? "1970-01-01T00:00:00.000Z";
  if (!Number.isFinite(Date.parse(generatedAt))) throw new NusaLeagueError("INVALID_GENERATED_AT", "generatedAt must be a valid timestamp");

  const scored = candidates.map((candidate) => {
    const entry = scoreCandidate(candidate, policy);
    // PBO reflects overfitting risk in the selection process across the whole league, not one
    // candidate in isolation, so every eligible entry shares the same penalty.
    if (pbo == null || entry.leagueScore == null) return entry;
    return freeze({ ...entry, leagueScore: entry.leagueScore - pbo.probabilityBacktestOverfitting * policy.probabilityBacktestOverfittingPenaltyWeight });
  });

  const rankedEligible = scored
    .filter((entry) => entry.eligible && entry.leagueScore != null)
    .sort((left, right) => right.leagueScore! - left.leagueScore! || left.id.localeCompare(right.id));
  const ranks = new Map(rankedEligible.map((entry, index) => [entry.id, index + 1] as const));
  const entries = scored
    .map((entry) => freeze({ ...entry, rank: ranks.get(entry.id) }))
    .sort((left, right) => (left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id));

  const provenance = new Set<string>();
  for (const entry of entries) for (const id of entry.sourceDatasetIds) provenance.add(id);

  return freeze({
    schemaVersion: 1,
    generatedAt,
    policy,
    ...(pbo == null ? {} : { probabilityBacktestOverfitting: pbo.probabilityBacktestOverfitting }),
    entries,
    coverage: freeze({
      candidateCount: entries.length,
      eligibleCount: rankedEligible.length,
      familyCount: new Set(entries.map((entry) => entry.familyId)).size,
    }),
    provenance: freeze({ sourceDatasetIds: Object.freeze([...provenance].sort()) }),
  });
}
