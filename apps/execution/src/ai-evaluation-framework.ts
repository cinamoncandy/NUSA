import { randomUUID } from "node:crypto";
import {
  digestAiEvaluationPayload,
  recordIsSelfConsistent as contractRecordIsSelfConsistent,
  type AiEvaluationRecord,
  type AiOutputEnvelope,
  type EvaluationDimensionResult,
  type EvaluationVerdict,
  type PromotionApprovalInput,
  type RegressionComparisonResult
} from "../../../packages/contracts/src/aiEvaluation";

/**
 * WO-039: AI Evaluation Framework.
 *
 * Zero-authority, evidence-only, read-only -- the same family as the Strategy
 * Research Promotion Gate and Multi-Agent Governance already in this repository.
 * This module NEVER executes an AI output, never sets `ownerApproved`, and never
 * mutates anything: it reads an AiOutputEnvelope and produces a verdict plus the
 * reasoning behind it.
 *
 * THE RULE THAT MATTERS MOST HERE: verdicts are never averaged into a single
 * score. A weighted total would let a hallucinated claim be diluted by three
 * unrelated passing dimensions. `aggregateVerdict` instead takes the WORST
 * dimension verdict, in a fixed order (FAIL > HOLD_INSUFFICIENT_DATA > WARN >
 * PASS), the same discipline `strategy-research-promotion-gate` already
 * established for this codebase.
 */

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const digest = digestAiEvaluationPayload;
/** Re-exported so callers of this module don't also need to import the contracts module directly. */
export const recordIsSelfConsistent = contractRecordIsSelfConsistent;

export class AiEvaluationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiEvaluationError";
  }
}

function assertEnvelope(envelope: AiOutputEnvelope): void {
  if (envelope.schemaVersion !== 1) throw new AiEvaluationError("UNSUPPORTED_SCHEMA_VERSION", "envelope schemaVersion is unsupported");
  if (!envelope.subjectId.trim()) throw new AiEvaluationError("EMPTY_SUBJECT_ID", "subjectId is required");
  if (!Number.isFinite(Date.parse(envelope.producedAt))) throw new AiEvaluationError("INVALID_PRODUCED_AT", "producedAt must be a valid timestamp");
  if (!/^[a-f0-9]{64}$/i.test(envelope.datasetContentSha256)) throw new AiEvaluationError("INVALID_DATASET_HASH", "datasetContentSha256 must be a sha256 hex digest");
  if (!Number.isInteger(envelope.operationalDataPoints) || envelope.operationalDataPoints < 0) throw new AiEvaluationError("INVALID_OPERATIONAL_DATA_POINTS", "operationalDataPoints must be a non-negative integer");
  const evidenceIds = new Set<string>();
  for (const evidence of envelope.evidenceBundle) {
    if (!evidence.evidenceId.trim()) throw new AiEvaluationError("EMPTY_EVIDENCE_ID", "evidence entries require a non-empty evidenceId");
    if (evidenceIds.has(evidence.evidenceId)) throw new AiEvaluationError("DUPLICATE_EVIDENCE_ID", `duplicate evidenceId: ${evidence.evidenceId}`);
    evidenceIds.add(evidence.evidenceId);
    if (!/^[a-f0-9]{64}$/i.test(evidence.contentSha256)) throw new AiEvaluationError("INVALID_EVIDENCE_HASH", `evidence ${evidence.evidenceId} contentSha256 must be a sha256 hex digest`);
  }
  const claimIds = new Set<string>();
  for (const claim of envelope.claims) {
    if (!claim.claimId.trim()) throw new AiEvaluationError("EMPTY_CLAIM_ID", "claims require a non-empty claimId");
    if (claimIds.has(claim.claimId)) throw new AiEvaluationError("DUPLICATE_CLAIM_ID", `duplicate claimId: ${claim.claimId}`);
    claimIds.add(claim.claimId);
    if (!claim.statement.trim()) throw new AiEvaluationError("EMPTY_CLAIM_STATEMENT", `claim ${claim.claimId} statement is required`);
  }
}

/**
 * A claim is SUPPORTED only if every evidence id it cites both exists in the
 * envelope's evidence bundle and is not UNVERIFIED. Citing an id that is not
 * present, or that IS present but declared UNVERIFIED, makes the claim
 * unsupported -- exactly as unsupported as citing nothing at all. This is the
 * "근거 없는 추천 Fail" safety condition made checkable rather than a caveat.
 */
export function detectUnsupportedClaims(envelope: AiOutputEnvelope): readonly string[] {
  const evidenceById = new Map(envelope.evidenceBundle.map((item) => [item.evidenceId, item] as const));
  const unsupported: string[] = [];
  for (const claim of envelope.claims) {
    if (claim.citedEvidenceIds.length === 0) { unsupported.push(claim.claimId); continue; }
    const resolvable = claim.citedEvidenceIds.every((id) => {
      const evidence = evidenceById.get(id);
      return evidence !== undefined && evidence.provenance !== "UNVERIFIED";
    });
    if (!resolvable) unsupported.push(claim.claimId);
  }
  return freeze(unsupported.sort());
}

function evidenceTraceabilityDimension(envelope: AiOutputEnvelope, unsupportedClaimIds: readonly string[]): EvaluationDimensionResult {
  if (envelope.claims.length === 0) return freeze({ dimension: "EVIDENCE_TRACEABILITY" as const, verdict: "WARN" as const, reasonCodes: freeze(["NO_CLAIMS_TO_TRACE"]) });
  const traceableRatio = 1 - unsupportedClaimIds.length / envelope.claims.length;
  if (unsupportedClaimIds.length === 0) return freeze({ dimension: "EVIDENCE_TRACEABILITY" as const, verdict: "PASS" as const, reasonCodes: freeze([]) });
  return freeze({
    dimension: "EVIDENCE_TRACEABILITY" as const,
    verdict: traceableRatio >= 0.5 ? "WARN" as const : "FAIL" as const,
    reasonCodes: freeze([`UNTRACEABLE_CLAIM_RATIO:${(1 - traceableRatio).toFixed(2)}`])
  });
}

/** A claim with zero or unresolvable citations is a hallucination candidate by definition here. */
function unsupportedClaimDimension(unsupportedClaimIds: readonly string[]): EvaluationDimensionResult {
  if (unsupportedClaimIds.length === 0) return freeze({ dimension: "UNSUPPORTED_CLAIM_DETECTION" as const, verdict: "PASS" as const, reasonCodes: freeze([]) });
  return freeze({ dimension: "UNSUPPORTED_CLAIM_DETECTION" as const, verdict: "FAIL" as const, reasonCodes: freeze(unsupportedClaimIds.map((id) => `UNSUPPORTED_CLAIM:${id}`)) });
}

/**
 * Synthetic-only evidence can never PASS, mirroring strategy-research-promotion-gate's
 * "synthetic evidence can never promote" rule. Mixed real+synthetic WARNs rather than
 * FAILs, since a real claim alongside a disclosed synthetic one is not itself dishonest.
 */
function datasetProvenanceDimension(envelope: AiOutputEnvelope): EvaluationDimensionResult {
  if (envelope.evidenceBundle.length === 0) return freeze({ dimension: "DATASET_PROVENANCE" as const, verdict: "HOLD_INSUFFICIENT_DATA" as const, reasonCodes: freeze(["NO_EVIDENCE_SUPPLIED"]) });
  const provenances = new Set(envelope.evidenceBundle.map((item) => item.provenance));
  if (provenances.has("UNVERIFIED")) return freeze({ dimension: "DATASET_PROVENANCE" as const, verdict: "FAIL" as const, reasonCodes: freeze(["UNVERIFIED_EVIDENCE_PRESENT"]) });
  if (provenances.size === 1 && provenances.has("SYNTHETIC_FIXTURE")) return freeze({ dimension: "DATASET_PROVENANCE" as const, verdict: "WARN" as const, reasonCodes: freeze(["ALL_EVIDENCE_SYNTHETIC"]) });
  if (provenances.has("SYNTHETIC_FIXTURE")) return freeze({ dimension: "DATASET_PROVENANCE" as const, verdict: "WARN" as const, reasonCodes: freeze(["MIXED_REAL_AND_SYNTHETIC_EVIDENCE"]) });
  return freeze({ dimension: "DATASET_PROVENANCE" as const, verdict: "PASS" as const, reasonCodes: freeze([]) });
}

/** Below this many independent operational observations, evaluation is HELD rather than guessed at. */
export const MINIMUM_OPERATIONAL_DATA_POINTS = 10;

function operationalSufficiencyDimension(envelope: AiOutputEnvelope): EvaluationDimensionResult {
  if (envelope.operationalDataPoints < MINIMUM_OPERATIONAL_DATA_POINTS) {
    return freeze({ dimension: "OPERATIONAL_SUFFICIENCY" as const, verdict: "HOLD_INSUFFICIENT_DATA" as const, reasonCodes: freeze([`OPERATIONAL_DATA_POINTS_BELOW_MINIMUM:${envelope.operationalDataPoints}/${MINIMUM_OPERATIONAL_DATA_POINTS}`]) });
  }
  return freeze({ dimension: "OPERATIONAL_SUFFICIENCY" as const, verdict: "PASS" as const, reasonCodes: freeze([]) });
}

const VERDICT_SEVERITY: Readonly<Record<EvaluationVerdict, number>> = freeze({ FAIL: 3, HOLD_INSUFFICIENT_DATA: 2, WARN: 1, PASS: 0 });

/** Worst-of. Never averaged -- see module docstring. */
export function aggregateVerdict(dimensions: readonly EvaluationDimensionResult[]): EvaluationVerdict {
  if (dimensions.length === 0) throw new AiEvaluationError("NO_DIMENSIONS", "at least one evaluation dimension is required");
  return dimensions.reduce((worst, current) => (VERDICT_SEVERITY[current.verdict] > VERDICT_SEVERITY[worst] ? current.verdict : worst), "PASS" as EvaluationVerdict);
}

function evaluateDimensions(envelope: AiOutputEnvelope): { readonly dimensions: readonly EvaluationDimensionResult[]; readonly unsupportedClaimIds: readonly string[] } {
  const unsupportedClaimIds = detectUnsupportedClaims(envelope);
  const dimensions = freeze([
    evidenceTraceabilityDimension(envelope, unsupportedClaimIds),
    unsupportedClaimDimension(unsupportedClaimIds),
    datasetProvenanceDimension(envelope),
    operationalSufficiencyDimension(envelope)
  ]);
  return { dimensions, unsupportedClaimIds };
}

export interface EvaluateOptions { readonly evaluatedAt?: string; readonly evaluationId?: string; readonly baseline?: AiEvaluationRecord; }

/**
 * Compares two evaluations of the SAME subject type produced from the same dataset.
 * A ratio computed across different datasets is not a comparison -- see the
 * cross-market-validation layer's identical concern about notional-level artifacts
 * masquerading as a real result. Mismatched datasets return improvementRatio: null
 * and an INCONCLUSIVE-shaped WARN rather than a fabricated number.
 */
export function compareAgainstBaseline(current: AiEvaluationRecord, baseline: AiEvaluationRecord): RegressionComparisonResult {
  const sameDataset = current.datasetContentSha256 === baseline.datasetContentSha256;
  if (!sameDataset) {
    return freeze({ baselineEvaluationId: baseline.evaluationId, sameDataset: false, improvementRatio: null, verdict: "WARN" as const, reasonCodes: freeze(["DATASET_MISMATCH_NOT_COMPARABLE"]) });
  }
  const currentScore = VERDICT_SEVERITY.FAIL - VERDICT_SEVERITY[current.verdict];
  const baselineScore = VERDICT_SEVERITY.FAIL - VERDICT_SEVERITY[baseline.verdict];
  const improvementRatio = baselineScore === 0 ? (currentScore > 0 ? 1 : 0) : (currentScore - baselineScore) / baselineScore;
  const verdict: EvaluationVerdict = improvementRatio < 0 ? "WARN" : "PASS";
  return freeze({ baselineEvaluationId: baseline.evaluationId, sameDataset: true, improvementRatio, verdict, reasonCodes: freeze(improvementRatio < 0 ? ["REGRESSED_VS_BASELINE"] : []) });
}

export function evaluateAiOutput(envelope: AiOutputEnvelope, options: EvaluateOptions = {}): AiEvaluationRecord {
  assertEnvelope(envelope);
  const { dimensions, unsupportedClaimIds } = evaluateDimensions(envelope);
  const dimensionVerdict = aggregateVerdict(dimensions);
  const regression = options.baseline === undefined ? null : compareAgainstBaseline(
    freeze({ schemaVersion: 1 as const, evaluationId: "PENDING", subjectType: envelope.subjectType, subjectId: envelope.subjectId, evaluatedAt: options.evaluatedAt ?? "1970-01-01T00:00:00.000Z", datasetContentSha256: envelope.datasetContentSha256, dimensions, unsupportedClaimIds, verdict: dimensionVerdict, regression: null, recordSha256: "" }),
    options.baseline
  );
  const verdict = regression !== null && VERDICT_SEVERITY[regression.verdict] > VERDICT_SEVERITY[dimensionVerdict] ? regression.verdict : dimensionVerdict;
  const base = {
    schemaVersion: 1 as const,
    evaluationId: options.evaluationId ?? randomUUID(),
    subjectType: envelope.subjectType,
    subjectId: envelope.subjectId,
    evaluatedAt: options.evaluatedAt ?? "1970-01-01T00:00:00.000Z",
    datasetContentSha256: envelope.datasetContentSha256,
    dimensions,
    unsupportedClaimIds,
    verdict,
    regression
  };
  return freeze({ ...base, recordSha256: digest(base) });
}

/**
 * Re-derives the verdict from the ORIGINAL envelope without calling evaluateAiOutput,
 * so a bug in the evaluator (or a tampered stored record) is caught rather than
 * confirmed -- the same independence strategy-research-promotion-gate's verifier uses.
 */
export function verifyAiEvaluationRecord(record: AiEvaluationRecord, envelope: AiOutputEnvelope, options: { readonly baseline?: AiEvaluationRecord } = {}): { readonly valid: boolean; readonly mismatches: readonly string[] } {
  const mismatches: string[] = [];
  if (!recordIsSelfConsistent(record)) mismatches.push("RECORD_HASH_MISMATCH");
  if (record.datasetContentSha256 !== envelope.datasetContentSha256) mismatches.push("DATASET_HASH_MISMATCH");
  const recomputed = evaluateDimensions(envelope);
  if (JSON.stringify(recomputed.unsupportedClaimIds) !== JSON.stringify(record.unsupportedClaimIds)) mismatches.push("UNSUPPORTED_CLAIMS_MISMATCH");
  const recomputedDimensionVerdict = aggregateVerdict(recomputed.dimensions);
  const recomputedRegression = options.baseline === undefined ? null : compareAgainstBaseline({ ...record, verdict: recomputedDimensionVerdict } as AiEvaluationRecord, options.baseline);
  const recomputedVerdict = recomputedRegression !== null && VERDICT_SEVERITY[recomputedRegression.verdict] > VERDICT_SEVERITY[recomputedDimensionVerdict] ? recomputedRegression.verdict : recomputedDimensionVerdict;
  if (recomputedVerdict !== record.verdict) mismatches.push("VERDICT_MISMATCH");
  return freeze({ valid: mismatches.length === 0, mismatches: freeze(mismatches) });
}

/**
 * Never sets ownerApproved to true. There is no path in this function, or anywhere
 * else in this module, that can produce `ownerApproved: true` -- promotion approval
 * is a human action taken outside this code.
 */
export function buildPromotionApprovalInput(record: AiEvaluationRecord): PromotionApprovalInput {
  return freeze({
    evaluationId: record.evaluationId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    verdict: record.verdict,
    unsupportedClaimIds: record.unsupportedClaimIds,
    requiresOwnerApproval: true as const,
    ownerApproved: false as const
  });
}
