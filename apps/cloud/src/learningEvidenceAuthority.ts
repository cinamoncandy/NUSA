/** Canonical read-back boundary for learning evidence. Implementations must use existing durable stores. */
export interface LearningEvidenceRecord {
  readonly recordId: string;
  readonly recordedAt: number;
}

export interface LearningEvidenceAuthority {
  readonly readResearch: (recordId: string) => LearningEvidenceRecord | undefined;
  readonly readPaper: (recordId: string) => LearningEvidenceRecord | undefined;
  /** A fresh indexed snapshot for validating one cycle without replaying a durable ledger per id. */
  readonly readResearchSnapshot?: () => readonly LearningEvidenceRecord[];
  /** A fresh indexed snapshot for validating one cycle without replaying the realized-period ledger per id. */
  readonly readPaperSnapshot?: () => readonly LearningEvidenceRecord[];
}

export function createLearningEvidenceAuthorityFromReaders(input: {
  readonly readResearch: (recordId: string) => LearningEvidenceRecord | undefined;
  readonly readPaper: (recordId: string) => LearningEvidenceRecord | undefined;
  readonly readResearchSnapshot?: () => readonly LearningEvidenceRecord[];
  readonly readPaperSnapshot?: () => readonly LearningEvidenceRecord[];
}): LearningEvidenceAuthority {
  if (input == null || typeof input.readResearch !== "function" || typeof input.readPaper !== "function") throw new Error("durable learning evidence readers are required");
  if (input.readResearchSnapshot != null && typeof input.readResearchSnapshot !== "function") throw new Error("durable research evidence snapshot reader is invalid");
  if (input.readPaperSnapshot != null && typeof input.readPaperSnapshot !== "function") throw new Error("durable PAPER evidence snapshot reader is invalid");
  return Object.freeze({
    readResearch: input.readResearch,
    readPaper: input.readPaper,
    ...(input.readResearchSnapshot == null ? {} : { readResearchSnapshot: input.readResearchSnapshot }),
    ...(input.readPaperSnapshot == null ? {} : { readPaperSnapshot: input.readPaperSnapshot }),
  });
}
