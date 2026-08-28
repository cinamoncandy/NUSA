import { createHash } from "node:crypto";
import { validatePaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";

export interface PaperExecutionCostAttribution {
  readonly schemaVersion: 1;
  readonly source: "PAPER_EXECUTION_BOUNDARY";
  readonly evidenceKind: "OBSERVED" | "CONSERVATIVE_MODEL";
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly candidateId: string;
  readonly quotePrice: number;
  readonly fillPrice: number;
  readonly feeAmount: number;
  readonly spreadAmount: number;
  readonly slippageAmount: number;
}

export interface CanonicalPaperOutcomeReconciliationInput {
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly startState: PaperAccountState;
  readonly endState: PaperAccountState;
}

export interface CanonicalPaperOutcomeReceipt {
  readonly schemaVersion: 1;
  readonly source: "CANONICAL_PAPER_ACCOUNT";
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly startEquity: number;
  readonly endEquity: number;
  readonly grossReturn: number;
  readonly netReturn: number;
  readonly turnover: number;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly fillCount: number;
  readonly candidateIds: readonly string[];
  readonly executionCostEvidenceIds: readonly string[];
  readonly receiptFingerprint: string;
}

export class PaperCanonicalOutcomeReconciliationError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperCanonicalOutcomeReconciliationError";
  }
}

type AttributedPaperFill = PaperFillRecord & { readonly executionCostAttribution?: PaperExecutionCostAttribution };

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const SHA256 = /^[a-f0-9]{64}$/;

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new PaperCanonicalOutcomeReconciliationError("INVALID_ACCOUNTING_VALUE", `${field} must be finite and non-negative`);
  return value;
}

function safeTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new PaperCanonicalOutcomeReconciliationError("INVALID_TIMESTAMP", `${field} must be a non-negative safe integer`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperCanonicalOutcomeReconciliationError("NON_FINITE_RECEIPT", "receipt contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  throw new PaperCanonicalOutcomeReconciliationError("UNSUPPORTED_RECEIPT_VALUE", "receipt contains an unsupported value");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function candidateIdFromFill(fill: PaperFillRecord): string {
  const provenance = fill.candidateProvenance;
  if (provenance == null) {
    throw new PaperCanonicalOutcomeReconciliationError("MISSING_CANDIDATE_PROVENANCE", `fill ${fill.id} has no canonical candidate provenance`);
  }
  if (provenance.schemaVersion !== 1 || provenance.source !== "CIO_DECISION_BINDING") {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate provenance is invalid`);
  }
  if (!Number.isSafeInteger(provenance.decisionAt) || provenance.decisionAt < 0 || provenance.decisionAt > fill.filledAt) {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate provenance time is invalid`);
  }
  try {
    return validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt).candidateId;
  } catch {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_CANDIDATE_PROVENANCE", `fill ${fill.id} candidate binding is invalid`);
  }
}

function validateCostAttribution(fill: PaperFillRecord, attribution: PaperExecutionCostAttribution | undefined): PaperExecutionCostAttribution {
  if (attribution == null) {
    if (fill.runtimeExecutionCostEvidence != null) {
      throw new PaperCanonicalOutcomeReconciliationError("INCOMPLETE_EXECUTION_COST_EVIDENCE", `fill ${fill.id} execution-cost evidence is incomplete`);
    }
    throw new PaperCanonicalOutcomeReconciliationError("MISSING_EXECUTION_COST_EVIDENCE", `fill ${fill.id} has no execution-cost attribution`);
  }
  if (attribution.schemaVersion !== 1 || attribution.source !== "PAPER_EXECUTION_BOUNDARY") {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_EXECUTION_COST_PROVENANCE", `fill ${fill.id} execution-cost provenance is invalid`);
  }
  if (attribution.evidenceKind !== "OBSERVED" && attribution.evidenceKind !== "CONSERVATIVE_MODEL") {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_EXECUTION_COST_PROVENANCE", `fill ${fill.id} execution-cost evidence kind is invalid`);
  }
  const evidenceId = attribution.evidenceId.trim();
  if (!evidenceId || !SHA256.test(attribution.evidenceFingerprintSha256)) {
    throw new PaperCanonicalOutcomeReconciliationError("INVALID_EXECUTION_COST_PROVENANCE", `fill ${fill.id} execution-cost evidence identity is invalid`);
  }
  const candidateId = attribution.candidateId.trim();
  if (!candidateId) throw new PaperCanonicalOutcomeReconciliationError("MISSING_CANDIDATE_ATTRIBUTION", `fill ${fill.id} has no candidate attribution`);
  const canonicalCandidateId = candidateIdFromFill(fill);
  if (candidateId !== canonicalCandidateId) {
    throw new PaperCanonicalOutcomeReconciliationError("CANDIDATE_ATTRIBUTION_MISMATCH", `fill ${fill.id} execution-cost candidate does not match canonical fill provenance`);
  }
  const quotePrice = finiteNonNegative(attribution.quotePrice, "quotePrice");
  const fillPrice = finiteNonNegative(attribution.fillPrice, "fillPrice");
  const feeAmount = finiteNonNegative(attribution.feeAmount, "feeAmount");
  const spreadAmount = finiteNonNegative(attribution.spreadAmount, "spreadAmount");
  const slippageAmount = finiteNonNegative(attribution.slippageAmount, "slippageAmount");
  if (quotePrice <= 0 || fillPrice <= 0) throw new PaperCanonicalOutcomeReconciliationError("INVALID_EXECUTION_PRICE", `fill ${fill.id} execution prices must be positive`);
  if (fillPrice !== fill.price || feeAmount !== fill.fee) {
    throw new PaperCanonicalOutcomeReconciliationError("COST_RECONCILIATION_MISMATCH", `fill ${fill.id} cost attribution does not match persisted fill accounting`);
  }
  return freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: attribution.evidenceKind,
    evidenceId,
    evidenceFingerprintSha256: attribution.evidenceFingerprintSha256,
    candidateId,
    quotePrice,
    fillPrice,
    feeAmount,
    spreadAmount,
    slippageAmount,
  });
}

function validateStateIdentity(startState: PaperAccountState, endState: PaperAccountState): void {
  if (startState.version !== 1 || endState.version !== 1) throw new PaperCanonicalOutcomeReconciliationError("UNSUPPORTED_ACCOUNT_SCHEMA", "PAPER account schema is unsupported");
  if (!Number.isFinite(startState.initialCapital) || startState.initialCapital <= 0 || startState.initialCapital !== endState.initialCapital) {
    throw new PaperCanonicalOutcomeReconciliationError("ACCOUNT_IDENTITY_MISMATCH", "PAPER account initial-capital identity changed across the realized period");
  }
}

export function reconcileCanonicalPaperOutcomeWindow(input: CanonicalPaperOutcomeReconciliationInput): CanonicalPaperOutcomeReceipt {
  const periodStartAt = safeTime(input.periodStartAt, "periodStartAt");
  const periodEndAt = safeTime(input.periodEndAt, "periodEndAt");
  if (periodEndAt <= periodStartAt) throw new PaperCanonicalOutcomeReconciliationError("INVALID_PERIOD_BOUNDS", "periodEndAt must be after periodStartAt");

  validateStateIdentity(input.startState, input.endState);
  if (input.startState.updatedAt !== periodStartAt || input.endState.updatedAt !== periodEndAt) {
    throw new PaperCanonicalOutcomeReconciliationError("STALE_ACCOUNT_SNAPSHOT", "canonical PAPER account snapshots must be captured exactly at the realized period boundaries");
  }

  const startEquity = finiteNonNegative(input.startState.equity, "startState.equity");
  const endEquity = finiteNonNegative(input.endState.equity, "endState.equity");
  if (startEquity <= 0) throw new PaperCanonicalOutcomeReconciliationError("INVALID_START_EQUITY", "realized PAPER period requires positive start equity");

  const startFillIds = new Set(input.startState.fills.map((fill) => fill.id));
  const periodFills = (input.endState.fills as readonly AttributedPaperFill[])
    .filter((fill) => !startFillIds.has(fill.id) && fill.filledAt > periodStartAt && fill.filledAt <= periodEndAt)
    .sort((left, right) => left.filledAt - right.filledAt || left.id.localeCompare(right.id));

  const candidateIds = new Set<string>();
  const executionCostEvidenceIds = new Set<string>();
  let turnoverNotional = 0;
  let feeAmount = 0;
  let spreadAmount = 0;
  let slippageAmount = 0;
  const seenFillIds = new Set<string>();

  for (const fill of periodFills) {
    if (!fill.id.trim() || seenFillIds.has(fill.id)) throw new PaperCanonicalOutcomeReconciliationError("DUPLICATE_FILL", "realized PAPER period contains a missing or duplicated fill identity");
    seenFillIds.add(fill.id);
    safeTime(fill.filledAt, "fill.filledAt");
    finiteNonNegative(fill.quantity, "fill.quantity");
    finiteNonNegative(fill.price, "fill.price");
    if (fill.quantity <= 0 || fill.price <= 0) throw new PaperCanonicalOutcomeReconciliationError("INVALID_FILL", `fill ${fill.id} has invalid quantity or price`);
    const attribution = validateCostAttribution(fill, fill.executionCostAttribution);
    candidateIds.add(attribution.candidateId);
    executionCostEvidenceIds.add(attribution.evidenceId);
    turnoverNotional += fill.quantity * fill.price;
    feeAmount += attribution.feeAmount;
    spreadAmount += attribution.spreadAmount;
    slippageAmount += attribution.slippageAmount;
  }

  if (![turnoverNotional, feeAmount, spreadAmount, slippageAmount].every(Number.isFinite)) {
    throw new PaperCanonicalOutcomeReconciliationError("NON_FINITE_ACCOUNTING", "realized PAPER execution accounting overflowed");
  }

  const turnover = turnoverNotional / startEquity;
  const feeRate = turnoverNotional === 0 ? 0 : feeAmount / turnoverNotional;
  const spreadRate = turnoverNotional === 0 ? 0 : spreadAmount / turnoverNotional;
  const slippageRate = turnoverNotional === 0 ? 0 : slippageAmount / turnoverNotional;
  const netReturn = endEquity / startEquity - 1;
  const grossReturn = netReturn + (feeAmount + spreadAmount + slippageAmount) / startEquity;

  if (![turnover, feeRate, spreadRate, slippageRate, netReturn, grossReturn].every(Number.isFinite)) {
    throw new PaperCanonicalOutcomeReconciliationError("NON_FINITE_ACCOUNTING", "realized PAPER return/cost accounting is non-finite");
  }

  const core = freeze({
    schemaVersion: 1 as const,
    source: "CANONICAL_PAPER_ACCOUNT" as const,
    periodStartAt,
    periodEndAt,
    startEquity,
    endEquity,
    grossReturn,
    netReturn,
    turnover,
    feeRate,
    spreadRate,
    slippageRate,
    fillCount: periodFills.length,
    candidateIds: freeze([...candidateIds].sort()),
    executionCostEvidenceIds: freeze([...executionCostEvidenceIds].sort()),
  });
  const receiptFingerprint = fingerprint(core);
  if (!SHA256.test(receiptFingerprint)) throw new PaperCanonicalOutcomeReconciliationError("INVALID_RECEIPT_FINGERPRINT", "canonical receipt fingerprint is invalid");
  return freeze({ ...core, receiptFingerprint });
}
