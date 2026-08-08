import { createResearchMemoryRecord, type ResearchMemoryRecord } from "../researchMemoryV2";

export interface AiResearchReviewInput {
  readonly recordId: string;
  readonly researchId: string;
  readonly parentRecordIds: readonly string[];
  readonly conclusion: string;
  readonly evidenceReferences: readonly string[];
  readonly criticSeverity: "none" | "low" | "medium" | "high" | "critical";
  readonly calibrationError?: number;
  readonly createdAt: string;
}

/** Review is persisted as read-only evidence/lesson, never as a strategy command. */
export function createAiResearchReview(input: AiResearchReviewInput): ResearchMemoryRecord {
  if (!input.evidenceReferences.length) throw new Error("AI research review requires evidence references");
  if (input.calibrationError != null && (!Number.isFinite(input.calibrationError) || input.calibrationError < 0 || input.calibrationError > 1)) throw new Error("calibrationError must be between zero and one");
  return createResearchMemoryRecord({ recordId: input.recordId, researchId: input.researchId, stage: "EVIDENCE", createdAt: input.createdAt, author: "ai-zero-authority", summary: input.conclusion, parentRecordIds: input.parentRecordIds, evidenceDirection: input.criticSeverity === "critical" || input.criticSeverity === "high" ? "REJECTS" : "NEUTRAL", payload: Object.freeze({ conclusion: input.conclusion, evidenceReferences: [...new Set(input.evidenceReferences)].sort(), criticSeverity: input.criticSeverity, calibrationError: input.calibrationError, productionMutationAllowed: false, promotionAllowed: false }) });
}
