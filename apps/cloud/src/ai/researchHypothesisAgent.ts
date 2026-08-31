import { createResearchMemoryRecord, type ResearchMemoryRecord } from "../researchMemoryV2";
import { validateResearchHypothesis, type ResearchHypothesis } from "../../../../packages/contracts/src/researchHypothesisContract";

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

export interface AiHypothesisDraftCompletionInput {
  readonly recordId: string;
  readonly researchId: string;
  /** The full ResearchHypothesis contract (Research Factory charter section 13). Its own
   * validateResearchHypothesis errors are surfaced verbatim, not re-derived here. */
  readonly hypothesis: ResearchHypothesis;
}

export class AiHypothesisContractInvalidError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`AI hypothesis contract invalid: ${errors.join(",")}`);
    this.name = "AiHypothesisContractInvalidError";
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Completes a DRAFT hypothesis into the full ResearchHypothesis contract (immutable id, family,
 * mechanism, target market, expected regime, invalidation condition, holding period, capacity
 * assumptions, transaction cost sensitivity, provenance) before it can enter the research pipeline
 * (candidate specification -> point-in-time dataset -> ... -> Strategy League).
 *
 * This is still a DRAFT-lifecycle, AI-zero-authority record: AI may complete a hypothesis's
 * content, never activate, validate, or promote it (that is EVALUATE/VALIDATE/PROMOTE territory,
 * owned elsewhere). Fails closed via validateResearchHypothesis before any record is created, so a
 * structurally invalid hypothesis (missing invalidation condition, out-of-range capacity or cost
 * fields, unrecognized family) never enters Research Memory in the first place.
 */
export function completeAiHypothesisDraft(input: AiHypothesisDraftCompletionInput): ResearchMemoryRecord {
  const validation = validateResearchHypothesis(input.hypothesis);
  if (!validation.valid) throw new AiHypothesisContractInvalidError(validation.errors);

  return createResearchMemoryRecord({
    recordId: input.recordId,
    researchId: input.researchId,
    stage: "HYPOTHESIS",
    createdAt: input.hypothesis.createdAt,
    author: "ai-zero-authority",
    summary: input.hypothesis.rationale,
    payload: Object.freeze({
      lifecycle: "DRAFT",
      hypothesis: input.hypothesis,
      productionMutationAllowed: false,
      promotionAllowed: false,
    }),
  });
}
