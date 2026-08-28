import { createHash } from "node:crypto";
import { validatePaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";

export interface PaperRuntimeExecutionCostEvidence {
  readonly schemaVersion: 1;
  readonly source: "PAPER_EXECUTION_BOUNDARY";
  readonly evidenceKind: "OBSERVED";
  readonly completeness: "INCOMPLETE";
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly candidateId: string;
  readonly quotePrice: number;
  readonly fillPrice: number;
  readonly feeAmount: number;
  readonly spreadAmount: null;
  readonly slippageAmount: null;
}

export class PaperRuntimeExecutionCostEvidenceError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperRuntimeExecutionCostEvidenceError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_EXECUTION_PRICE", `${field} must be finite and positive`);
  }
  return value;
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_EXECUTION_COST", `${field} must be finite and non-negative`);
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * Captures only facts the current canonical PAPER simulator actually knows at fill time.
 * Spread and slippage stay explicitly unknown. This evidence must therefore remain
 * non-promotable until a trusted observed source or an accepted conservative model
 * completes those components.
 */
export function buildPaperRuntimeExecutionCostEvidence(
  fill: PaperFillRecord,
  quotePrice: number,
): PaperRuntimeExecutionCostEvidence {
  const provenance = fill.candidateProvenance;
  if (provenance == null) {
    throw new PaperRuntimeExecutionCostEvidenceError("MISSING_CANDIDATE_PROVENANCE", `fill ${fill.id} has no canonical candidate provenance`);
  }
  if (provenance.schemaVersion !== 1 || provenance.source !== "CIO_DECISION_BINDING") {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate provenance is invalid`);
  }
  if (!Number.isSafeInteger(provenance.decisionAt) || provenance.decisionAt < 0 || provenance.decisionAt > fill.filledAt) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate provenance time is invalid`);
  }

  let candidateId: string;
  try {
    candidateId = validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt).candidateId;
  } catch {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate binding is invalid`);
  }

  const normalizedQuotePrice = finitePositive(quotePrice, "quotePrice");
  const fillPrice = finitePositive(fill.price, "fill.price");
  const feeAmount = finiteNonNegative(fill.fee, "fill.fee");
  if (!fill.id.trim()) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_FILL_IDENTITY", "fill identity is required");
  }

  const core = Object.freeze({
    schemaVersion: 1 as const,
    source: "PAPER_EXECUTION_BOUNDARY" as const,
    evidenceKind: "OBSERVED" as const,
    completeness: "INCOMPLETE" as const,
    fillId: fill.id,
    candidateId,
    quotePrice: normalizedQuotePrice,
    fillPrice,
    feeAmount,
    spreadAmount: null,
    slippageAmount: null,
  });
  const evidenceFingerprintSha256 = fingerprint(core);
  if (!SHA256.test(evidenceFingerprintSha256)) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_EVIDENCE_FINGERPRINT", "runtime execution-cost evidence fingerprint is invalid");
  }
  const evidenceId = `paper-cost:${fill.id}:${evidenceFingerprintSha256.slice(0, 24)}`;
  return Object.freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: "OBSERVED",
    completeness: "INCOMPLETE",
    evidenceId,
    evidenceFingerprintSha256,
    candidateId,
    quotePrice: normalizedQuotePrice,
    fillPrice,
    feeAmount,
    spreadAmount: null,
    slippageAmount: null,
  });
}
