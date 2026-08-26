import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { DeflatedSharpeEvidence, PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";

/**
 * NUSA League: the research-only ranking layer over the existing evidence primitives
 * (Benchmark Scorecard, DSR/PBO, Regime Health, Abstention, Ghost Execution, Counterfactual,
 * Trial Ledger). It computes no new performance metric -- every number here is read directly
 * from evidence those modules already produced -- and it never gains order/broker/capital/LIVE
 * authority. Its only output is a research ranking plus the reasons behind it.
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
  readonly abstention?: AbstentionAssessment;
  readonly ghostExecution?: GhostExecutionResult;
  readonly counterfactual?: CounterfactualAssessment;
  readonly trialLedgerSummary?: ResearchTrialLedgerSummary;
}

export interface LeaguePolicy {
  readonly probabilityBacktestOverfittingPenaltyWeight: number;
}

export interface LeagueCandidateComponents {
  readonly outOfSamplePerformance: number;
  readonly benchmarkExcess: number;
  readonly maximumDrawdown: number;
  readonly riskAdjusted?: number;
  readonly regimeRobustness?: number;
  readonly costAdjustedGhostReturn?: number;
  readonly abstentionQuality?: number;
  readonly counterfactualRegret?: number;
  readonly trialFailureRatio?: number;
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
  if (candidate.abstention != null) {
    if (candidate.abstention.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_ABSTENTION_SCHEMA", `candidate ${candidate.id} abstention schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.abstention.sourceDatasetIds, "ABSTENTION_PROVENANCE_MISMATCH", `candidate ${candidate.id} abstention`);
  }
  if (candidate.ghostExecution != null) {
    if (candidate.ghostExecution.schemaVersion !== 1) throw new NusaLeagueError("UNSUPPORTED_GHOST_SCHEMA", `candidate ${candidate.id} ghost execution schema is unsupported`);
    assertProvenanceCovers(datasetId, candidate.ghostExecution.sourceDatasetIds, "GHOST_EXECUTION_PROVENANCE_MISMATCH", `candidate ${candidate.id} ghost execution`);
    if (candidate.ghostExecution.status === "SIMULATED") assertFinite(candidate.ghostExecution.netReturn!, "NON_FINITE_GHOST_EVIDENCE", `candidate ${candidate.id} ghost netReturn must be finite`);
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
}

function candidateProvenance(candidate: LeagueCandidateInput): readonly string[] {
  const ids = new Set<string>([candidate.benchmark.datasetId]);
  for (const id of candidate.regime?.sourceDatasetIds ?? []) ids.add(id);
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

function scoreCandidate(candidate: LeagueCandidateInput): LeagueRankedEntry {
  const reasons: string[] = [...candidate.benchmark.reasons];
  const eligible = candidate.benchmark.eligible;
  const trialFailureRatio = candidate.trialLedgerSummary != null && candidate.trialLedgerSummary.trialCount > 0
    ? (candidate.trialLedgerSummary.failedCount + candidate.trialLedgerSummary.rejectedCount) / candidate.trialLedgerSummary.trialCount
    : undefined;
  if (candidate.deflatedSharpe != null && !candidate.deflatedSharpe.passes) reasons.push("DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD");
  if (candidate.regime?.state === "STRESSED") reasons.push("STRESSED_REGIME_CONTEXT");
  if (candidate.abstention?.decision === "ABSTAIN") reasons.push("ABSTAINED_SOUND_DECISION");
  if (candidate.ghostExecution?.status === "SKIPPED") reasons.push("GHOST_EXECUTION_SKIPPED_BY_ABSTENTION");
  if (candidate.counterfactual != null && candidate.counterfactual.regret > 0) reasons.push("COUNTERFACTUAL_REGRET_OBSERVED");

  const components: LeagueCandidateComponents = freeze({
    outOfSamplePerformance: candidate.benchmark.totalReturn,
    benchmarkExcess: candidate.benchmark.averageOutperformance,
    maximumDrawdown: candidate.benchmark.maximumDrawdown,
    ...(candidate.deflatedSharpe == null ? {} : { riskAdjusted: candidate.deflatedSharpe.deflatedSharpeProbability }),
    ...(candidate.regime == null ? {} : { regimeRobustness: candidate.regime.score }),
    ...(candidate.ghostExecution?.status === "SIMULATED" ? { costAdjustedGhostReturn: candidate.ghostExecution.netReturn } : {}),
    ...(candidate.abstention == null ? {} : { abstentionQuality: abstentionQuality(candidate.abstention) }),
    ...(candidate.counterfactual == null ? {} : { counterfactualRegret: candidate.counterfactual.regret }),
    ...(trialFailureRatio == null ? {} : { trialFailureRatio }),
  });

  const evidenceCategories = [candidate.deflatedSharpe, candidate.regime, candidate.abstention, candidate.ghostExecution, candidate.counterfactual, candidate.trialLedgerSummary];
  const evidenceBreadth = evidenceCategories.filter((value) => value != null).length / evidenceCategories.length;

  const leagueScore = eligible
    ? components.outOfSamplePerformance * 1_000
      + components.benchmarkExcess * 500
      - components.maximumDrawdown * 500
      + (components.riskAdjusted ?? 0) * 300
      + (components.regimeRobustness ?? 0.5) * 100
      + (components.costAdjustedGhostReturn ?? 0) * 400
      + (components.abstentionQuality ?? 0.5) * 100
      - (components.counterfactualRegret ?? 0) * 300
      - (components.trialFailureRatio ?? 0) * 50
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

  const pbo = options.probabilityBacktestOverfitting;
  if (pbo != null) {
    if (!Number.isInteger(pbo.strategyCount) || pbo.strategyCount < 2) throw new NusaLeagueError("INVALID_PBO_EVIDENCE", "league PBO evidence must cover at least two strategies");
    if (pbo.probabilityBacktestOverfitting < 0 || pbo.probabilityBacktestOverfitting > 1) throw new NusaLeagueError("INVALID_PBO_EVIDENCE", "probabilityBacktestOverfitting must be between 0 and 1");
  }

  const generatedAt = options.generatedAt ?? "1970-01-01T00:00:00.000Z";
  if (!Number.isFinite(Date.parse(generatedAt))) throw new NusaLeagueError("INVALID_GENERATED_AT", "generatedAt must be a valid timestamp");

  const scored = candidates.map((candidate) => {
    const entry = scoreCandidate(candidate);
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
