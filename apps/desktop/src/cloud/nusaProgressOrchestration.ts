import { assessNusaProgressLevel, type NusaProgressLevelAssessment } from "./nusaProgressLevel";
import { projectNusaProgressForSupervisor, type NusaProgressSupervisorProjection } from "./nusaProgressProjection";
import {
  computeNusaProgressScorecard,
  type NusaProgressItemInput,
  type NusaProgressScorecard,
  type NusaProgressScorecardPolicy,
} from "./nusaProgressScorecard";

export interface NusaProgressOrchestrationResult {
  readonly schemaVersion: 1;
  readonly scorecard: NusaProgressScorecard;
  readonly assessment: NusaProgressLevelAssessment;
  readonly supervisor: NusaProgressSupervisorProjection;
  readonly authority: "READ_ONLY";
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Canonical read-only progress path. Evidence must already have been produced by its class-specific
 * provenance adapter; this function never fabricates, upgrades, or substitutes evidence classes.
 */
export function orchestrateNusaProgress(
  items: readonly NusaProgressItemInput[],
  policy: NusaProgressScorecardPolicy,
): NusaProgressOrchestrationResult {
  const scorecard = computeNusaProgressScorecard(items, policy);
  const assessment = assessNusaProgressLevel(scorecard);
  const supervisor = projectNusaProgressForSupervisor(scorecard, assessment);

  if (supervisor.authority !== "READ_ONLY") {
    throw new Error("NUSA progress supervisor projection must remain READ_ONLY");
  }

  return freeze({
    schemaVersion: 1,
    scorecard,
    assessment,
    supervisor,
    authority: "READ_ONLY",
  });
}
