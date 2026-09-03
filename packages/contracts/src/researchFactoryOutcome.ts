/**
 * Canonical fail-closed Research Factory outcome for #1094.
 *
 * This is a pure evidence-classification contract only. It does not run backtests, create a second
 * research engine, promote a Strategy League champion, or grant execution authority. Existing
 * research/OOS/robustness components supply the evidence states; this contract makes the final
 * research disposition explicit and deterministic.
 */

export type ResearchFactoryOutcome = "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";
export type ResearchEvidenceState = "PASS" | "FAIL" | "UNKNOWN";

export interface ResearchFactoryEvidence {
  readonly provenanceIntegrity: ResearchEvidenceState;
  readonly costEvidence: ResearchEvidenceState;
  readonly outOfSampleEvidence: ResearchEvidenceState;
  readonly multipleTestingControl: ResearchEvidenceState;
  readonly regimeRobustness: ResearchEvidenceState;
  readonly sensitivityAndStress: ResearchEvidenceState;
  readonly denominatorIntegrity: ResearchEvidenceState;
  readonly replayDeterminism: ResearchEvidenceState;
}

export interface ResearchFactoryDecisionInput {
  readonly candidateId: string;
  readonly evaluationId: string;
  readonly evidence: ResearchFactoryEvidence;
}

export interface ResearchFactoryDecision {
  readonly candidateId: string;
  readonly evaluationId: string;
  readonly outcome: ResearchFactoryOutcome;
  readonly reasons: readonly string[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const EVIDENCE_KEYS = [
  "provenanceIntegrity",
  "costEvidence",
  "outOfSampleEvidence",
  "multipleTestingControl",
  "regimeRobustness",
  "sensitivityAndStress",
  "denominatorIntegrity",
  "replayDeterminism",
] as const satisfies readonly (keyof ResearchFactoryEvidence)[];
const STATE = new Set<ResearchEvidenceState>(["PASS", "FAIL", "UNKNOWN"]);

function assertInput(input: ResearchFactoryDecisionInput): void {
  if (!input || typeof input !== "object") throw new Error("RESEARCH_FACTORY_INPUT_INVALID");
  if (!ID.test(input.candidateId)) throw new Error("RESEARCH_FACTORY_CANDIDATE_ID_INVALID");
  if (!ID.test(input.evaluationId)) throw new Error("RESEARCH_FACTORY_EVALUATION_ID_INVALID");
  if (!input.evidence || typeof input.evidence !== "object") throw new Error("RESEARCH_FACTORY_EVIDENCE_INVALID");
  for (const key of EVIDENCE_KEYS) if (!STATE.has(input.evidence[key])) throw new Error(`RESEARCH_FACTORY_EVIDENCE_STATE_INVALID:${key}`);
}

export function decideResearchFactoryOutcome(input: ResearchFactoryDecisionInput): ResearchFactoryDecision {
  assertInput(input);
  const failed = EVIDENCE_KEYS.filter((key) => input.evidence[key] === "FAIL");
  const unknown = EVIDENCE_KEYS.filter((key) => input.evidence[key] === "UNKNOWN");
  const outcome: ResearchFactoryOutcome = failed.length > 0 ? "REJECTED" : unknown.length > 0 ? "INSUFFICIENT" : "QUALIFIED_FOR_LEAGUE";
  const reasons = failed.length > 0
    ? failed.map((key) => `FAILED:${key}`)
    : unknown.length > 0
      ? unknown.map((key) => `MISSING:${key}`)
      : ["ALL_REQUIRED_RESEARCH_EVIDENCE_PASSED"];
  return Object.freeze({
    candidateId: input.candidateId,
    evaluationId: input.evaluationId,
    outcome,
    reasons: Object.freeze(reasons),
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
