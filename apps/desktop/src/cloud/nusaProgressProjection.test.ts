import { describe, expect, it } from "vitest";
import type { NusaProgressScorecard } from "./nusaProgressScorecard";
import type { NusaProgressLevelAssessment } from "./nusaProgressLevel";
import { projectNusaProgressForSupervisor } from "./nusaProgressProjection";

describe("projectNusaProgressForSupervisor", () => {
  it("projects canonical progress without granting authority", () => {
    const scorecard: NusaProgressScorecard = {
      schemaVersion: 1,
      asOf: 123,
      overallProgressRatio: 0.5,
      domains: [{ domain: "RELIABILITY_RECOVERY", configuredWeight: 1, itemWeightTotal: 1, earnedItemWeight: 0.5, completionRatio: 0.5 }],
      items: [],
      reasons: ["EVIDENCE_PARTIAL"],
    };
    const assessment: NusaProgressLevelAssessment = {
      schemaVersion: 1,
      level: 4,
      reasons: ["EVIDENCE_BACKED_LEVEL_4"],
      achievedCriteria: ["LV4_ALL_DOMAIN_COVERAGE"],
      blockedCriteria: ["LV5_RUNTIME_EVIDENCE_PRESENT"],
    };

    expect(projectNusaProgressForSupervisor(scorecard, assessment)).toEqual({
      schemaVersion: 1,
      asOf: 123,
      level: 4,
      overallProgressRatio: 0.5,
      domains: [{ domain: "RELIABILITY_RECOVERY", completionRatio: 0.5 }],
      achievedCriteria: ["LV4_ALL_DOMAIN_COVERAGE"],
      blockedCriteria: ["LV5_RUNTIME_EVIDENCE_PRESENT"],
      reasons: ["EVIDENCE_BACKED_LEVEL_4", "EVIDENCE_PARTIAL"],
      authority: "READ_ONLY",
    });
  });
});
