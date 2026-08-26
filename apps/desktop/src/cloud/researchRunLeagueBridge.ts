import { createResearchBenchmarkScorecard, type ResearchBenchmarkPolicy, type ResearchBenchmarkSlice } from "./researchBenchmarkScorecard";
import type { ResearchExperimentResult } from "./researchDataset";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";
import { runLeagueResearchPipeline } from "./leagueResearchPipeline";
import { evaluateLeague, type LeagueCandidateInput, type LeaguePolicy, type LeagueStanding } from "./nusaLeague";
import type { LeagueCapitalAllocationAdvisory, LeagueCapitalAllocationPolicy } from "./leagueCapitalAllocation";
import { LeagueCapitalAllocationError } from "./leagueCapitalAllocation";

/** Minimal adapter joining a real research run to the existing League pipeline. */
export interface ResearchRunCandidate {
  readonly id: string;
  readonly familyId: string;
  readonly experiment: ResearchExperimentResult;
  /** Optional point-in-time multi-window regime evidence for this candidate's own experiment. */
  readonly regimeAwareEvaluation?: RegimeAwareStrategyEvaluation;
}

export interface ResearchRunLeagueResult {
  readonly schemaVersion: 1;
  readonly evidenceMode: "RESEARCH_TIER_ONLY";
  readonly standing: LeagueStanding;
  readonly allocation?: LeagueCapitalAllocationAdvisory;
  readonly allocationUnavailableReason?: string;
  readonly reasons: readonly string[];
}

export class ResearchRunLeagueBridgeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ResearchRunLeagueBridgeError"; }
}
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function buildResearchRunLeague(
  candidates: readonly ResearchRunCandidate[],
  options: {
    readonly benchmarkPolicy?: ResearchBenchmarkPolicy;
    readonly leaguePolicy?: LeaguePolicy;
    readonly allocationPolicy?: Partial<LeagueCapitalAllocationPolicy>;
    readonly generatedAt?: string;
  } = {},
): ResearchRunLeagueResult {
  if (candidates.length === 0) throw new ResearchRunLeagueBridgeError("EMPTY_RESEARCH_RUN", "research run league requires at least one candidate");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim()) throw new ResearchRunLeagueBridgeError("INVALID_CANDIDATE_ID", "candidate id is required");
    if (!candidate.familyId.trim()) throw new ResearchRunLeagueBridgeError("INVALID_FAMILY_ID", `candidate ${candidate.id} requires a familyId`);
    if (ids.has(candidate.id)) throw new ResearchRunLeagueBridgeError("DUPLICATE_CANDIDATE_ID", `duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
  }

  const slices: readonly ResearchBenchmarkSlice[] = candidates.map((candidate) => ({ id: candidate.id, experiment: candidate.experiment }));
  const scorecard = createResearchBenchmarkScorecard(slices, options.benchmarkPolicy);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const leagueCandidates: readonly LeagueCandidateInput[] = scorecard.slices.map((slice) => {
    const candidate = byId.get(slice.id)!;
    return {
      id: slice.id,
      familyId: candidate.familyId,
      benchmark: slice,
      ...(candidate.regimeAwareEvaluation == null ? {} : { regimeAwareEvaluation: candidate.regimeAwareEvaluation }),
    };
  });

  const reasons: string[] = ["RESEARCH_TIER_ONLY", "NOT_PAPER_EVIDENCE", "NO_EXECUTION_AUTHORITY"];
  if (new Set(candidates.map((candidate) => candidate.familyId)).size <= 1) reasons.push("SINGLE_FAMILY_RESEARCH_RUN");
  if (candidates.every((candidate) => candidate.regimeAwareEvaluation != null)) reasons.push("POINT_IN_TIME_REGIME_EVIDENCE_PRESENT");

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
