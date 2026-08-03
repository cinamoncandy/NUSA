import { createHash } from "node:crypto";

/**
 * WO-039: AI Evaluation Framework -- contract types.
 *
 * This framework evaluates the QUALITY of an AI-produced output (an AI Coach
 * recommendation, an AI-generated strategy candidate, a backtest result, or an
 * optimizer's parameter suggestion). It never executes, promotes, or acts on any
 * output it evaluates -- see aiEvaluationFramework.ts for the zero-authority
 * guarantee this contract exists to make checkable.
 *
 * No AI Coach, strategy generator, or optimizer exists in this repository yet
 * (see docs/implementation/research-lab-mvp.md, docs/implementation/walk-forward-research.md).
 * This framework is intentionally shaped so any future producer of one of these
 * four subject types has a gate waiting for it on day one, rather than a gate
 * retrofitted after the capability already ships.
 */

export type AiEvaluationSubjectType = "AI_COACH" | "STRATEGY_GENERATION" | "BACKTEST_RESULT" | "OPTIMIZER_RESULT";

/** How trustworthy the evidence behind a claim is. Never inferred -- always declared by the producer. */
export type EvidenceProvenance = "REAL" | "SYNTHETIC_FIXTURE" | "UNVERIFIED";

export interface EvidenceCitation {
  readonly evidenceId: string;
  /** e.g. "BACKTEST_REPORT", "WALK_FORWARD_RESULT", "RESEARCH_DATASET", "COST_STRESS_REPORT". */
  readonly sourceType: string;
  readonly contentSha256: string;
  readonly provenance: EvidenceProvenance;
}

export interface EvaluatedClaim {
  readonly claimId: string;
  readonly statement: string;
  /** Evidence IDs from the same envelope's evidenceBundle this claim rests on. Empty means unsupported. */
  readonly citedEvidenceIds: readonly string[];
}

/**
 * The thing being evaluated. One shape for all four subject types -- an AI Coach
 * recommendation and a strategy-generation candidate are, from this framework's
 * point of view, both "a set of claims backed by a set of evidence," which is
 * exactly the thing that can be hallucinated.
 */
export interface AiOutputEnvelope {
  readonly schemaVersion: 1;
  readonly subjectType: AiEvaluationSubjectType;
  readonly subjectId: string;
  readonly producedAt: string;
  readonly producerIdentifier: string;
  readonly claims: readonly EvaluatedClaim[];
  readonly evidenceBundle: readonly EvidenceCitation[];
  readonly datasetContentSha256: string;
  /** How many independent operational observations (Paper sessions, completed orders, etc.) back this output. */
  readonly operationalDataPoints: number;
}

export type EvaluationVerdict = "PASS" | "WARN" | "FAIL" | "HOLD_INSUFFICIENT_DATA";

export type EvaluationDimensionName =
  | "EVIDENCE_TRACEABILITY"
  | "UNSUPPORTED_CLAIM_DETECTION"
  | "DATASET_PROVENANCE"
  | "OPERATIONAL_SUFFICIENCY";

export interface EvaluationDimensionResult {
  readonly dimension: EvaluationDimensionName;
  readonly verdict: EvaluationVerdict;
  readonly reasonCodes: readonly string[];
}

export interface RegressionComparisonResult {
  readonly baselineEvaluationId: string;
  readonly sameDataset: boolean;
  /** null when sameDataset is false -- a ratio computed across different datasets is not a comparison. */
  readonly improvementRatio: number | null;
  readonly verdict: EvaluationVerdict;
  readonly reasonCodes: readonly string[];
}

/**
 * What an owner would need in front of them to decide on promotion. This object
 * never approves anything itself: ownerApproved is always false when produced by
 * this framework, and nothing in this contract or its implementation can set it
 * to true. A human sets that field, outside this code, by a separate action.
 */
export interface PromotionApprovalInput {
  readonly evaluationId: string;
  readonly subjectType: AiEvaluationSubjectType;
  readonly subjectId: string;
  readonly verdict: EvaluationVerdict;
  readonly unsupportedClaimIds: readonly string[];
  readonly requiresOwnerApproval: true;
  readonly ownerApproved: false;
}

export interface AiEvaluationRecord {
  readonly schemaVersion: 1;
  readonly evaluationId: string;
  readonly subjectType: AiEvaluationSubjectType;
  readonly subjectId: string;
  readonly evaluatedAt: string;
  readonly datasetContentSha256: string;
  readonly dimensions: readonly EvaluationDimensionResult[];
  readonly unsupportedClaimIds: readonly string[];
  readonly verdict: EvaluationVerdict;
  readonly regression: RegressionComparisonResult | null;
  readonly recordSha256: string;
}

/**
 * Canonical hashing lives here, in the contract layer, rather than in the execution-side
 * evaluator or the storage repository: both of those need it, and storage may only depend
 * on application code (apps/execution) as TYPES, never as a runtime import -- see the
 * repository-architecture-validation suite's STORAGE_RUNTIME_APP_REFERENCE rule. Contracts
 * is the one layer both are already allowed to depend on at runtime.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key]);
    return result;
  }
  return value;
}

export function digestAiEvaluationPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

/**
 * A record is self-consistent when hashing everything except its own recordSha256
 * reproduces that same hash. Independent of any envelope -- this is what a storage
 * layer checks before accepting a record it did not itself compute.
 */
export function recordIsSelfConsistent(record: AiEvaluationRecord): boolean {
  const { recordSha256, ...withoutHash } = record;
  return digestAiEvaluationPayload(withoutHash) === recordSha256;
}
