import type { NusaProgressDomain, NusaProgressScorecard } from "./nusaProgressScorecard";
import type { NusaProgressLevelAssessment } from "./nusaProgressLevel";

export interface NusaProgressSupervisorDomain {
  readonly domain: NusaProgressDomain;
  readonly completionRatio: number;
}

export interface NusaProgressSupervisorProjection {
  readonly schemaVersion: 1;
  readonly asOf: number;
  readonly level: number;
  readonly overallProgressRatio: number;
  readonly domains: readonly NusaProgressSupervisorDomain[];
  readonly achievedCriteria: readonly string[];
  readonly blockedCriteria: readonly string[];
  readonly reasons: readonly string[];
  readonly authority: "READ_ONLY";
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Read-only supervisor projection. It never recomputes evidence acceptance or level semantics;
 * those remain owned by the canonical scorecard and level assessment engines.
 */
export function projectNusaProgressForSupervisor(
  scorecard: NusaProgressScorecard,
  assessment: NusaProgressLevelAssessment,
): NusaProgressSupervisorProjection {
  if (scorecard.schemaVersion !== 1 || assessment.schemaVersion !== 1) {
    throw new Error("unsupported NUSA progress schema");
  }
  return freeze({
    schemaVersion: 1,
    asOf: scorecard.asOf,
    level: assessment.level,
    overallProgressRatio: scorecard.overallProgressRatio,
    domains: freeze(scorecard.domains.map(({ domain, completionRatio }) => freeze({ domain, completionRatio }))),
    achievedCriteria: freeze([...assessment.achievedCriteria]),
    blockedCriteria: freeze([...assessment.blockedCriteria]),
    reasons: freeze([...assessment.reasons, ...scorecard.reasons]),
    authority: "READ_ONLY",
  });
}
