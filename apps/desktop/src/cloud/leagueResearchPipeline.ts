import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import { evaluateLeague, type LeagueCandidateInput, type LeaguePolicy, type LeagueStanding } from "./nusaLeague";
import {
  adviseLeagueCapitalAllocation,
  type LeagueCapitalAllocationAdvisory,
  type LeagueCapitalAllocationPolicy,
} from "./leagueCapitalAllocation";

/**
 * Thin research-only orchestration layer that composes the existing NUSA League ranking and
 * League capital-allocation advisory. It deliberately owns no performance metric, broker path,
 * order sizing, capital amount, credential, or LIVE authority.
 */
export interface LeagueResearchPipelineInput {
  readonly candidates: readonly LeagueCandidateInput[];
  readonly probabilityBacktestOverfitting?: PboCscvEvidence;
  readonly leaguePolicy?: LeaguePolicy;
  readonly allocationPolicy?: Partial<LeagueCapitalAllocationPolicy>;
  readonly generatedAt?: string;
}

export interface LeagueResearchPipelineResult {
  readonly schemaVersion: 1;
  readonly standing: LeagueStanding;
  readonly allocation: LeagueCapitalAllocationAdvisory;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function runLeagueResearchPipeline(input: LeagueResearchPipelineInput): LeagueResearchPipelineResult {
  const standing = evaluateLeague(input.candidates, {
    ...(input.probabilityBacktestOverfitting == null
      ? {}
      : { probabilityBacktestOverfitting: input.probabilityBacktestOverfitting }),
    ...(input.leaguePolicy == null ? {} : { policy: input.leaguePolicy }),
    ...(input.generatedAt == null ? {} : { generatedAt: input.generatedAt }),
  });

  const allocation = adviseLeagueCapitalAllocation(standing, input.allocationPolicy);

  return freeze({
    schemaVersion: 1,
    standing,
    allocation,
  });
}
