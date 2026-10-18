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
