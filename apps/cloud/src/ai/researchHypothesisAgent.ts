import { createResearchMemoryRecord, type ResearchMemoryRecord } from "../researchMemoryV2";

export interface AiHypothesisDraftInput {
  readonly recordId: string;
  readonly researchId: string;
  readonly question: string;
  readonly hypothesis: string;
  readonly evidenceReferences: readonly string[];
  readonly modelVersionId: string;
  readonly promptArtifactDigest: string;
  readonly createdAt: string;
}

/** AI may create only a DRAFT hypothesis; it cannot activate or promote it. */
export function createAiHypothesisDraft(input: AiHypothesisDraftInput): ResearchMemoryRecord {
  if (!input.evidenceReferences.length) throw new Error("AI hypothesis requires evidence references");
  return createResearchMemoryRecord({ recordId: input.recordId, researchId: input.researchId, stage: "HYPOTHESIS", createdAt: input.createdAt, author: "ai-zero-authority", summary: input.hypothesis, payload: Object.freeze({ lifecycle: "DRAFT", question: input.question, hypothesis: input.hypothesis, evidenceReferences: [...new Set(input.evidenceReferences)].sort(), modelVersionId: input.modelVersionId, promptArtifactDigest: input.promptArtifactDigest, productionMutationAllowed: false, promotionAllowed: false }) });
}
