/** Canonical read-back boundary for learning evidence. Implementations must use existing durable stores. */
export interface LearningEvidenceAuthority {
  readonly readResearch: (recordId: string) => { readonly recordId: string; readonly recordedAt: number } | undefined;
  readonly readPaper: (recordId: string) => { readonly recordId: string; readonly recordedAt: number } | undefined;
}

export function createLearningEvidenceAuthorityFromReaders(input: {
  readonly readResearch: (recordId: string) => { readonly recordId: string; readonly recordedAt: number } | undefined;
  readonly readPaper: (recordId: string) => { readonly recordId: string; readonly recordedAt: number } | undefined;
}): LearningEvidenceAuthority {
  if (input == null || typeof input.readResearch !== "function" || typeof input.readPaper !== "function") throw new Error("durable learning evidence readers are required");
  return Object.freeze({ readResearch: input.readResearch, readPaper: input.readPaper });
}

export function createLearningEvidenceAuthority(input: {
  readonly research: readonly { readonly recordId: string; readonly recordedAt: number }[];
  readonly paper: readonly { readonly recordId: string; readonly recordedAt: number }[];
}): LearningEvidenceAuthority {
  const research = new Map(input.research.map((item) => [item.recordId, item]));
  const paper = new Map(input.paper.map((item) => [item.recordId, item]));
  return createLearningEvidenceAuthorityFromReaders({ readResearch: (recordId) => research.get(recordId), readPaper: (recordId) => paper.get(recordId) });
}
