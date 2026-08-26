import { createResearchBenchmarkScorecard, type ResearchBenchmarkPolicy, type ResearchBenchmarkSlice } from "./researchBenchmarkScorecard";
import type { ResearchExperimentResult } from "./researchDataset";
import { runLeagueResearchPipeline } from "./leagueResearchPipeline";
import { evaluateLeague, type LeagueCandidateInput, type LeaguePolicy, type LeagueStanding } from "./nusaLeague";
import type { LeagueCapitalAllocationAdvisory, LeagueCapitalAllocationPolicy } from "./leagueCapitalAllocation";
import { LeagueCapitalAllocationError } from "./leagueCapitalAllocation";

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
 * Research tier only: produces no order, broker call, capital amount, PAPER evidence, or LIVE
 * authority, and never presents a research result as PAPER or LIVE validation.
 */
export function buildResearchRunLeague(
  candidates: readonly ResearchRunCandidate[],
  options: {
    readonly benchmarkPolicy?: ResearchBenchmarkPolicy;
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

  const familyById = new Map(candidates.map((candidate) => [candidate.id, candidate.familyId] as const));
  const leagueCandidates: readonly LeagueCandidateInput[] = scorecard.slices.map((slice) => ({
    id: slice.id,
    familyId: familyById.get(slice.id)!,
    benchmark: slice,
  }));

  const reasons: string[] = ["RESEARCH_TIER_ONLY", "NOT_PAPER_EVIDENCE", "NO_EXECUTION_AUTHORITY"];
  if (new Set(familyById.values()).size <= 1) reasons.push("SINGLE_FAMILY_RESEARCH_RUN");

  const pipelineInput = {
    candidates: leagueCandidates,
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
    reasons: freeze([...new Set(reasons)].sort()),
  });
}
