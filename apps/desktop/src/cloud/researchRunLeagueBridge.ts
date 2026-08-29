import { createResearchBenchmarkScorecard, type ResearchBenchmarkPolicy, type ResearchBenchmarkSlice } from "./researchBenchmarkScorecard";
import type { ResearchExperimentResult } from "./researchDataset";
import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { DeflatedSharpeEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";
import { runLeagueResearchPipeline } from "./leagueResearchPipeline";
import { evaluateLeague, type LeagueCandidateInput, type LeaguePolicy, type LeagueStanding } from "./nusaLeague";
import type { LeagueCapitalAllocationAdvisory, LeagueCapitalAllocationPolicy } from "./leagueCapitalAllocation";
import { LeagueCapitalAllocationError } from "./leagueCapitalAllocation";
import { extractResearchRunOosObservations, ResearchRunOosObservationError, type OosObservationTrace } from "./researchRunOosObservationEvidence";
import { gatePaperForwardLeagueEvidence, type PaperForwardLeagueEvidenceDecision, type PaperForwardLeagueEvidenceSource } from "./paperForwardLeagueEvidence";

/**
 * Minimal adapter joining a real research run to the League pipeline.
 *
 * The canonical research execution path (scripts/research-real-market-run.js) already produces
 * exactly what the benchmark scorecard consumes -- a ResearchExperimentResult per candidate --
 * but stopped at printing raw out-of-sample numbers, so the League ranking and the capital
 * allocation advisory had no caller and could not influence anything.
 *
 * This owns no research logic of its own. It computes no metric, runs no backtest, and defines no
 * ranking: it maps each experiment onto the benchmark scorecard the League already requires, then
 * hands the result to the existing pipeline. It deliberately does not create a second research
 * engine alongside the one that exists.
 *
 * The familyId is supplied by the caller rather than derived here, because only the caller knows
 * whether two candidates are genuinely different strategies or two tunings of one. Labeling
 * tuned variants as separate families would defeat the allocation's family concentration cap,
 * which is the whole reason that cap exists.
 */
export interface ResearchRunCandidate {
  /** Stable candidate id. Must match the benchmark slice id the scorecard produces. */
  readonly id: string;
  /** Strategy family. Tuned variants of one strategy MUST share a familyId. */
  readonly familyId: string;
  readonly experiment: ResearchExperimentResult;
  /** Optional point-in-time multi-window regime evidence for this candidate's own experiment. */
  readonly regimeAwareEvaluation?: RegimeAwareStrategyEvaluation;
  /** Candidate-specific DSR produced from this search's cost-aware OOS returns. */
  readonly deflatedSharpe?: DeflatedSharpeEvidence;
  /** Current regime evidence produced by the canonical regime-health engine, when available. */
  readonly regime?: RegimeHealthAssessment;
  /** Existing abstention decision for this candidate, when the canonical engine produced one. */
  readonly abstention?: AbstentionAssessment;
  /** Existing ghost execution result; this bridge never creates one implicitly. */
  readonly ghostExecution?: GhostExecutionResult;
  /** Existing counterfactual assessment; this bridge never creates one implicitly. */
  readonly counterfactual?: CounterfactualAssessment;
  /** Existing immutable trial-ledger summary for the research attempt, when available. */
  readonly trialLedgerSummary?: ResearchTrialLedgerSummary;
  /**
   * Longitudinal PAPER evidence may enter League only through the VERIFIED provenance gate.
   * INSUFFICIENT evidence remains visible in bridge reasons but never populates paperPerformance.
   */
  readonly paperForwardEvidence?: PaperForwardLeagueEvidenceSource;
}

export interface ResearchRunLeagueResult {
  readonly schemaVersion: 1;
  readonly evidenceMode: "RESEARCH_TIER_ONLY";
  /** The League ranking. Always produced: a refused allocation does not invalidate the ranking. */
  readonly standing: LeagueStanding;
  readonly allocation?: LeagueCapitalAllocationAdvisory;
  /** Why no allocation advisory could be produced, when that is the case. */
  readonly allocationUnavailableReason?: string;
  readonly reasons: readonly string[];
  /** Candle-level OOS observations preserved for downstream Ghost/Counterfactual adapters. */
  readonly oosObservationEvidence?: Readonly<Record<string, readonly OosObservationTrace[]>>;
}

export class ResearchRunLeagueBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunLeagueBridgeError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Joins real research-run experiments to the existing League ranking and allocation advisory.
 * Research-advisory authority only: produces no order, broker call, capital amount, or LIVE
 * authority. PAPER evidence, when supplied, is accepted only after VERIFIED candidate/dataset/hash
 * admission and remains PAPER/SHADOW evidence inside the research ranking.
 */
export function buildResearchRunLeague(
  candidates: readonly ResearchRunCandidate[],
  options: {
    readonly benchmarkPolicy?: ResearchBenchmarkPolicy;
    readonly probabilityBacktestOverfitting?: PboCscvEvidence;
    readonly leaguePolicy?: LeaguePolicy;
    readonly allocationPolicy?: Partial<LeagueCapitalAllocationPolicy>;
    readonly generatedAt?: string;
  } = {},
): ResearchRunLeagueResult {
  if (candidates.length === 0) {
    throw new ResearchRunLeagueBridgeError("EMPTY_RESEARCH_RUN", "research run league requires at least one candidate");
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim()) throw new ResearchRunLeagueBridgeError("INVALID_CANDIDATE_ID", "candidate id is required");
    if (!candidate.familyId.trim()) throw new ResearchRunLeagueBridgeError("INVALID_FAMILY_ID", `candidate ${candidate.id} requires a familyId`);
    if (ids.has(candidate.id)) throw new ResearchRunLeagueBridgeError("DUPLICATE_CANDIDATE_ID", `duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
  }

  const slices: readonly ResearchBenchmarkSlice[] = candidates.map((candidate) => ({
    id: candidate.id,
    experiment: candidate.experiment,
  }));
  const scorecard = createResearchBenchmarkScorecard(slices, options.benchmarkPolicy);

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const paperDecisions = new Map<string, PaperForwardLeagueEvidenceDecision>();
  const leagueCandidates: readonly LeagueCandidateInput[] = scorecard.slices.map((slice) => {
    const candidate = byId.get(slice.id)!;
    const paperDecision = candidate.paperForwardEvidence == null
      ? undefined
      : gatePaperForwardLeagueEvidence(
          {
            candidateId: candidate.id,
            datasetId: candidate.experiment.manifest.datasetId,
            datasetContentSha256: candidate.experiment.manifest.contentSha256,
          },
          candidate.paperForwardEvidence,
        );
    if (paperDecision != null) paperDecisions.set(candidate.id, paperDecision);
    return {
      id: slice.id,
      familyId: candidate.familyId,
      benchmark: slice,
      ...(candidate.deflatedSharpe == null ? {} : { deflatedSharpe: candidate.deflatedSharpe }),
      ...(candidate.regime == null ? {} : { regime: candidate.regime }),
      ...(candidate.regimeAwareEvaluation == null ? {} : { regimeAwareEvaluation: candidate.regimeAwareEvaluation }),
      ...(candidate.abstention == null ? {} : { abstention: candidate.abstention }),
      ...(candidate.ghostExecution == null ? {} : { ghostExecution: candidate.ghostExecution }),
      ...(candidate.counterfactual == null ? {} : { counterfactual: candidate.counterfactual }),
      ...(candidate.trialLedgerSummary == null ? {} : { trialLedgerSummary: candidate.trialLedgerSummary }),
      ...(paperDecision?.paperPerformance == null ? {} : { paperPerformance: paperDecision.paperPerformance }),
    };
  });

  const reasons: string[] = ["RESEARCH_TIER_ONLY", "NO_EXECUTION_AUTHORITY"];
  const paperDecisionValues = [...paperDecisions.values()];
  if (paperDecisionValues.some((decision) => decision.strength === "VERIFIED")) reasons.push("VERIFIED_PAPER_FORWARD_EVIDENCE_PRESENT");
  else reasons.push("NOT_PAPER_EVIDENCE");
  if (paperDecisionValues.some((decision) => decision.strength === "INSUFFICIENT")) reasons.push("PAPER_FORWARD_EVIDENCE_INSUFFICIENT");

  const oosObservationEvidence: Record<string, readonly OosObservationTrace[]> = {};
  for (const candidate of candidates) {
    try {
      oosObservationEvidence[candidate.id] = extractResearchRunOosObservations(candidate.id, candidate.experiment);
    } catch (error) {
      if (error instanceof ResearchRunOosObservationError && (
        error.code === "MISSING_OOS_OBSERVATION_SOURCE" ||
        error.code === "INSUFFICIENT_OBSERVATION_EVIDENCE"
      )) {
        reasons.push("INSUFFICIENT_OBSERVATION_EVIDENCE");
        continue;
      }
      if (error instanceof ResearchRunOosObservationError) {
        throw new ResearchRunLeagueBridgeError(
          "INVALID_OOS_OBSERVATION_EVIDENCE",
          `candidate ${candidate.id} contains invalid OOS evidence`,
        );
      }
      throw error;
    }
  }
  if (Object.keys(oosObservationEvidence).length === candidates.length) reasons.push("OOS_OBSERVATION_PROVENANCE_PRESENT");
  if (new Set(candidates.map((candidate) => candidate.familyId)).size <= 1) reasons.push("SINGLE_FAMILY_RESEARCH_RUN");
  if (candidates.every((candidate) => candidate.regimeAwareEvaluation != null)) reasons.push("POINT_IN_TIME_REGIME_EVIDENCE_PRESENT");
  if (options.probabilityBacktestOverfitting != null) reasons.push("SEARCH_OVERFITTING_EVIDENCE_PRESENT");

  const pipelineInput = {
    candidates: leagueCandidates,
    ...(options.probabilityBacktestOverfitting == null
      ? {}
      : { probabilityBacktestOverfitting: options.probabilityBacktestOverfitting }),
    ...(options.leaguePolicy == null ? {} : { leaguePolicy: options.leaguePolicy }),
    ...(options.allocationPolicy == null ? {} : { allocationPolicy: options.allocationPolicy }),
    ...(options.generatedAt == null ? {} : { generatedAt: options.generatedAt }),
  };

  let standing: LeagueStanding;
  let allocation: LeagueCapitalAllocationAdvisory | undefined;
  let allocationUnavailableReason: string | undefined;
  try {
    const pipeline = runLeagueResearchPipeline(pipelineInput);
    standing = pipeline.standing;
    allocation = pipeline.allocation;
  } catch (error) {
    // A refused allocation is a real research finding -- typically that the run's candidates do
    // not yet carry enough independent evidence to justify allocating across them at all. It is
    // not a reason to discard the ranking, and never a reason to invent an allocation.
    if (!(error instanceof LeagueCapitalAllocationError)) throw error;
    standing = evaluateLeague(leagueCandidates, {
      ...(options.probabilityBacktestOverfitting == null
        ? {}
        : { probabilityBacktestOverfitting: options.probabilityBacktestOverfitting }),
      ...(options.leaguePolicy == null ? {} : { policy: options.leaguePolicy }),
      ...(options.generatedAt == null ? {} : { generatedAt: options.generatedAt }),
    });
    allocationUnavailableReason = error.code;
    reasons.push("NO_ALLOCATION_ADVISORY_AVAILABLE");
  }

  return freeze({
    schemaVersion: 1,
    evidenceMode: "RESEARCH_TIER_ONLY",
    standing,
    ...(allocation == null ? {} : { allocation }),
    ...(allocationUnavailableReason == null ? {} : { allocationUnavailableReason }),
    ...(Object.keys(oosObservationEvidence).length === 0 ? {} : { oosObservationEvidence: freeze(oosObservationEvidence) }),
    reasons: freeze([...new Set(reasons)].sort()),
  });
}