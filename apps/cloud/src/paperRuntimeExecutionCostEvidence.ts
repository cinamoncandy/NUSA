import { createHash } from "node:crypto";
import { validatePaperCandidateExecutionBinding, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { validatePaperOrderBookQuoteReceipt, type PaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";

export interface PaperRuntimeCostEvidenceCandidateProvenance {
  readonly schemaVersion: 1;
  readonly source: "CIO_DECISION_BINDING";
  readonly decisionAt: number;
  readonly binding: PaperCandidateExecutionBinding;
}

export interface PaperRuntimeCostEvidenceFillInput {
  readonly id: string;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: number;
  readonly candidateProvenance?: PaperRuntimeCostEvidenceCandidateProvenance;
}

export interface PaperRuntimeCompleteCostEvidenceFillInput extends PaperRuntimeCostEvidenceFillInput {
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
}

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

/**
 * Complete execution-cost attribution derived only from immutable public order-book evidence
 * plus the exact persisted PAPER fill. This shape intentionally matches the canonical realized-
 * period reconciler contract and never grants execution authority.
 */
export interface PaperCompletedExecutionCostEvidence {
  readonly schemaVersion: 1;
  readonly source: "PAPER_EXECUTION_BOUNDARY";
  readonly evidenceKind: "OBSERVED";
  readonly completeness: "COMPLETE";
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly candidateId: string;
  readonly quotePrice: number;
  readonly fillPrice: number;
  readonly feeAmount: number;
  readonly spreadAmount: number;
  readonly slippageAmount: number;
  readonly quoteReceiptFingerprintSha256: string;
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

function canonicalCandidateId(fill: PaperRuntimeCostEvidenceFillInput): string {
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
  try {
    return validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt).candidateId;
  } catch {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate binding is invalid`);
  }
}

function buildCore(fill: PaperRuntimeCostEvidenceFillInput, quotePrice: number) {
  if (!fill.id.trim()) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_FILL_IDENTITY", "fill identity is required");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    source: "PAPER_EXECUTION_BOUNDARY" as const,
    evidenceKind: "OBSERVED" as const,
    completeness: "INCOMPLETE" as const,
    fillId: fill.id,
    candidateId: canonicalCandidateId(fill),
    quotePrice: finitePositive(quotePrice, "quotePrice"),
    fillPrice: finitePositive(fill.price, "fill.price"),
    feeAmount: finiteNonNegative(fill.fee, "fill.fee"),
    spreadAmount: null,
    slippageAmount: null,
  });
}

/**
 * Captures only facts the current canonical PAPER simulator actually knows at fill time.
 * Spread and slippage stay explicitly unknown. This evidence must therefore remain
 * non-promotable until a trusted observed source or an accepted conservative model
 * completes those components.
 */
export function buildPaperRuntimeExecutionCostEvidence(
  fill: PaperRuntimeCostEvidenceFillInput,
  quotePrice: number,
): PaperRuntimeExecutionCostEvidence {
  const core = buildCore(fill, quotePrice);
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
    candidateId: core.candidateId,
    quotePrice: core.quotePrice,
    fillPrice: core.fillPrice,
    feeAmount: core.feeAmount,
    spreadAmount: null,
    slippageAmount: null,
  });
}

/**
 * Converts a validated point-in-time order-book receipt and the exact PAPER fill into complete,
 * observed cost evidence. Spread is the side-touch distance from mid; slippage is only additional
 * adverse movement beyond that observed touch. Favorable movement never becomes a negative cost.
 */
export function buildPaperCompletedExecutionCostEvidence(
  fill: PaperRuntimeCompleteCostEvidenceFillInput,
  receipt: PaperOrderBookQuoteReceipt,
  maximumQuoteAgeMs: number,
): PaperCompletedExecutionCostEvidence {
  if (!fill.market.trim()) throw new PaperRuntimeExecutionCostEvidenceError("INVALID_MARKET", "fill market is required");
  const quantity = finitePositive(fill.quantity, "fill.quantity");
  let validatedReceipt: PaperOrderBookQuoteReceipt;
  try {
    validatedReceipt = validatePaperOrderBookQuoteReceipt(receipt, fill.market, fill.filledAt, maximumQuoteAgeMs);
  } catch (error) {
    const code = error != null && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "INVALID_QUOTE_RECEIPT";
    throw new PaperRuntimeExecutionCostEvidenceError(code, error instanceof Error ? error.message : "quote receipt is invalid");
  }

  const candidateId = canonicalCandidateId(fill);
  const fillPrice = finitePositive(fill.price, "fill.price");
  const feeAmount = finiteNonNegative(fill.fee, "fill.fee");
  const midPrice = (validatedReceipt.bestBidPrice + validatedReceipt.bestAskPrice) / 2;
  const quotePrice = fill.side === "BUY" ? validatedReceipt.bestAskPrice : validatedReceipt.bestBidPrice;
  const spreadPerUnit = Math.abs(quotePrice - midPrice);
  const adverseSlippagePerUnit = fill.side === "BUY"
    ? Math.max(0, fillPrice - quotePrice)
    : Math.max(0, quotePrice - fillPrice);
  const spreadAmount = finiteNonNegative(spreadPerUnit * quantity, "spreadAmount");
  const slippageAmount = finiteNonNegative(adverseSlippagePerUnit * quantity, "slippageAmount");

  const core = Object.freeze({
    schemaVersion: 1 as const,
    source: "PAPER_EXECUTION_BOUNDARY" as const,
    evidenceKind: "OBSERVED" as const,
    completeness: "COMPLETE" as const,
    fillId: fill.id,
    candidateId,
    quotePrice,
    fillPrice,
    feeAmount,
    spreadAmount,
    slippageAmount,
    quoteReceiptFingerprintSha256: validatedReceipt.fingerprintSha256,
  });
  const evidenceFingerprintSha256 = fingerprint(core);
  if (!SHA256.test(evidenceFingerprintSha256)) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_EVIDENCE_FINGERPRINT", "completed execution-cost evidence fingerprint is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: "OBSERVED",
    completeness: "COMPLETE",
    evidenceId: `paper-cost:${fill.id}:${evidenceFingerprintSha256.slice(0, 24)}`,
    evidenceFingerprintSha256,
    candidateId,
    quotePrice,
    fillPrice,
    feeAmount,
    spreadAmount,
    slippageAmount,
    quoteReceiptFingerprintSha256: validatedReceipt.fingerprintSha256,
  });
}

export function validatePaperRuntimeExecutionCostEvidence(
  fill: PaperRuntimeCostEvidenceFillInput,
  evidence: PaperRuntimeExecutionCostEvidence,
): PaperRuntimeExecutionCostEvidence {
  if (
    evidence.schemaVersion !== 1 ||
    evidence.source !== "PAPER_EXECUTION_BOUNDARY" ||
    evidence.evidenceKind !== "OBSERVED" ||
    evidence.completeness !== "INCOMPLETE" ||
    evidence.spreadAmount !== null ||
    evidence.slippageAmount !== null
  ) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_RUNTIME_COST_EVIDENCE", `fill ${fill.id} runtime cost evidence contract is invalid`);
  }
  const expected = buildPaperRuntimeExecutionCostEvidence(fill, evidence.quotePrice);
  if (
    evidence.evidenceId !== expected.evidenceId ||
    evidence.evidenceFingerprintSha256 !== expected.evidenceFingerprintSha256 ||
    evidence.candidateId !== expected.candidateId ||
    evidence.fillPrice !== expected.fillPrice ||
    evidence.feeAmount !== expected.feeAmount
  ) {
    throw new PaperRuntimeExecutionCostEvidenceError("RUNTIME_COST_EVIDENCE_MISMATCH", `fill ${fill.id} runtime cost evidence does not match canonical fill facts`);
  }
  return expected;
}

export function validatePaperCompletedExecutionCostEvidence(
  fill: PaperRuntimeCompleteCostEvidenceFillInput,
  receipt: PaperOrderBookQuoteReceipt,
  maximumQuoteAgeMs: number,
  evidence: PaperCompletedExecutionCostEvidence,
): PaperCompletedExecutionCostEvidence {
  const expected = buildPaperCompletedExecutionCostEvidence(fill, receipt, maximumQuoteAgeMs);
  if (JSON.stringify(evidence) !== JSON.stringify(expected)) {
    throw new PaperRuntimeExecutionCostEvidenceError("COMPLETE_COST_EVIDENCE_MISMATCH", `fill ${fill.id} completed execution-cost evidence does not match canonical quote/fill facts`);
  }
  return expected;
}
