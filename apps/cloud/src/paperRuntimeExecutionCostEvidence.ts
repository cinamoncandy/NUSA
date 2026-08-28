import { createHash } from "node:crypto";
import { validatePaperCandidateExecutionBinding, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";

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

export interface PaperObservedExecutionQuote {
  readonly schemaVersion: 1;
  readonly source: "UPBIT_PUBLIC_ORDERBOOK";
  readonly market: string;
  readonly observedAt: number;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
}

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
  readonly quoteEvidenceId?: string;
  readonly quoteEvidenceFingerprintSha256?: string;
  readonly quoteObservedAt?: number;
  readonly quoteBidPrice?: number;
  readonly quoteAskPrice?: number;
}

export interface PaperOrderBookObservationInput {
  readonly market: string;
  readonly observedAt: number;
  readonly totalAskSize: number;
  readonly totalBidSize: number;
  readonly units: readonly PaperOrderBookUnit[];
}

export interface PaperOrderBookUnit {
  readonly askPrice: number;
  readonly bidPrice: number;
  readonly askSize: number;
  readonly bidSize: number;
}

export interface PaperObservedExecutionCostFillInput extends PaperRuntimeCostEvidenceFillInput {
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
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

const OBSERVED_QUOTE_MAX_AGE_MS = 5_000;
const OBSERVED_MARKET = /^KRW-[A-Z0-9-]+$/;
const MAX_ORDERBOOK_UNITS = 30;

function stableCanonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperRuntimeExecutionCostEvidenceError("NON_FINITE_ORDERBOOK", "public orderbook evidence contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map((item) => stableCanonical(item, seen)).join(",") + "]";
  if (typeof value === "object") {
    if (seen.has(value)) throw new PaperRuntimeExecutionCostEvidenceError("CYCLIC_ORDERBOOK", "public orderbook evidence is cyclic");
    seen.add(value);
    const serialized = "{" + Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => JSON.stringify(key) + ":" + stableCanonical(item, seen)).join(",") + "}";
    seen.delete(value);
    return serialized;
  }
  throw new PaperRuntimeExecutionCostEvidenceError("UNSUPPORTED_ORDERBOOK_VALUE", "public orderbook evidence contains an unsupported value");
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(stableCanonical(value), "utf8").digest("hex");
}

function normalizeObservedMarket(value: unknown): string {
  if (typeof value !== "string") throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_MARKET", "public orderbook market is invalid");
  const market = value.trim().toUpperCase();
  if (!OBSERVED_MARKET.test(market)) throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_MARKET", "public orderbook market is invalid");
  return market;
}

function safeObservedTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_TIMESTAMP", field + " is invalid");
  return Number(value);
}

function orderBookUnit(unit: PaperOrderBookUnit, index: number): PaperOrderBookUnit {
  const askPrice = finitePositive(unit.askPrice, "orderbook[" + index + "].askPrice");
  const bidPrice = finitePositive(unit.bidPrice, "orderbook[" + index + "].bidPrice");
  const askSize = finiteNonNegative(unit.askSize, "orderbook[" + index + "].askSize");
  const bidSize = finiteNonNegative(unit.bidSize, "orderbook[" + index + "].bidSize");
  if (askPrice < bidPrice) throw new PaperRuntimeExecutionCostEvidenceError("CROSSED_ORDERBOOK", "public orderbook ask is below bid");
  return Object.freeze({ askPrice, bidPrice, askSize, bidSize });
}

/**
 * Converts a validated public orderbook message into a safe, immutable quote snapshot.
 * Raw depth is used only to fingerprint the observation and is never persisted with the fill.
 */
export function buildPaperObservedExecutionQuote(input: PaperOrderBookObservationInput): PaperObservedExecutionQuote {
  const market = normalizeObservedMarket(input.market);
  const observedAt = safeObservedTimestamp(input.observedAt, "orderbook.observedAt");
  const totalAskSize = finiteNonNegative(input.totalAskSize, "orderbook.totalAskSize");
  const totalBidSize = finiteNonNegative(input.totalBidSize, "orderbook.totalBidSize");
  if (!Array.isArray(input.units) || input.units.length === 0 || input.units.length > MAX_ORDERBOOK_UNITS) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_DEPTH", "public orderbook depth is invalid");
  }
  const units = input.units.map(orderBookUnit);
  const bidPrice = Math.max(...units.map((unit) => unit.bidPrice));
  const askPrice = Math.min(...units.map((unit) => unit.askPrice));
  if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || askPrice < bidPrice) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_QUOTE", "public orderbook best quote is invalid");
  }
  const evidence = { schemaVersion: 1, source: "UPBIT_PUBLIC_ORDERBOOK", market, observedAt, totalAskSize, totalBidSize, units };
  const evidenceFingerprintSha256 = stableDigest(evidence);
  return Object.freeze({
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_ORDERBOOK",
    market,
    observedAt,
    bidPrice,
    askPrice,
    evidenceId: "paper-orderbook:" + market + ":" + observedAt + ":" + evidenceFingerprintSha256.slice(0, 24),
    evidenceFingerprintSha256,
  });
}

function compareObservedAttribution(left: PaperExecutionCostAttribution, right: PaperExecutionCostAttribution): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.source === right.source
    && left.evidenceKind === right.evidenceKind
    && left.evidenceId === right.evidenceId
    && left.evidenceFingerprintSha256 === right.evidenceFingerprintSha256
    && left.candidateId === right.candidateId
    && left.quotePrice === right.quotePrice
    && left.fillPrice === right.fillPrice
    && left.feeAmount === right.feeAmount
    && left.spreadAmount === right.spreadAmount
    && left.slippageAmount === right.slippageAmount;
}

/**
 * Completes candidate-specific execution cost attribution only when a fresh public quote
 * was observed at the PAPER execution boundary. Missing or stale quotes remain incomplete.
 */
export function buildPaperObservedExecutionCostAttribution(
  fill: PaperObservedExecutionCostFillInput,
  quote: PaperObservedExecutionQuote,
): PaperExecutionCostAttribution {
  const market = normalizeObservedMarket(fill.market);
  if (market !== normalizeObservedMarket(quote.market)) throw new PaperRuntimeExecutionCostEvidenceError("ORDERBOOK_MARKET_MISMATCH", "fill " + fill.id + " orderbook market does not match the fill");
  if (fill.side !== "BUY" && fill.side !== "SELL") throw new PaperRuntimeExecutionCostEvidenceError("INVALID_FILL_SIDE", "fill " + fill.id + " side is invalid");
  finitePositive(fill.quantity, "fill.quantity");
  const fillPrice = finitePositive(fill.price, "fill.price");
  const feeAmount = finiteNonNegative(fill.fee, "fill.fee");
  const filledAt = safeObservedTimestamp(fill.filledAt, "fill.filledAt");
  if (quote.schemaVersion !== 1 || quote.source !== "UPBIT_PUBLIC_ORDERBOOK" || quote.market !== market || !SHA256.test(quote.evidenceFingerprintSha256) || !quote.evidenceId.trim()) {
    throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_QUOTE", "fill " + fill.id + " orderbook quote is invalid");
  }
  const observedAt = safeObservedTimestamp(quote.observedAt, "quote.observedAt");
  if (observedAt > filledAt || filledAt - observedAt > OBSERVED_QUOTE_MAX_AGE_MS) {
    throw new PaperRuntimeExecutionCostEvidenceError("STALE_ORDERBOOK_QUOTE", "fill " + fill.id + " orderbook quote is stale");
  }
  const bidPrice = finitePositive(quote.bidPrice, "quote.bidPrice");
  const askPrice = finitePositive(quote.askPrice, "quote.askPrice");
  if (askPrice < bidPrice) throw new PaperRuntimeExecutionCostEvidenceError("INVALID_ORDERBOOK_QUOTE", "fill " + fill.id + " orderbook quote is crossed");
  const quotePrice = fill.side === "BUY" ? askPrice : bidPrice;
  const halfSpread = (askPrice - bidPrice) / 2;
  const adverseDifference = fill.side === "BUY" ? Math.max(0, fillPrice - quotePrice) : Math.max(0, quotePrice - fillPrice);
  const spreadAmount = finiteNonNegative(halfSpread * fill.quantity, "spreadAmount");
  const slippageAmount = finiteNonNegative(adverseDifference * fill.quantity, "slippageAmount");
  const candidateId = canonicalCandidateId(fill);
  const core = {
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: "OBSERVED",
    fillId: fill.id,
    market,
    side: fill.side,
    quantity: fill.quantity,
    candidateId,
    quote: { evidenceId: quote.evidenceId, evidenceFingerprintSha256: quote.evidenceFingerprintSha256, observedAt, bidPrice, askPrice },
    quotePrice,
    fillPrice,
    feeAmount,
    spreadAmount,
    slippageAmount,
  };
  const evidenceFingerprintSha256 = stableDigest(core);
  return Object.freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_BOUNDARY",
    evidenceKind: "OBSERVED",
    evidenceId: "paper-cost-observed:" + fill.id + ":" + evidenceFingerprintSha256.slice(0, 24),
    evidenceFingerprintSha256,
    candidateId,
    quotePrice,
    fillPrice,
    feeAmount,
    spreadAmount,
    slippageAmount,
    quoteEvidenceId: quote.evidenceId,
    quoteEvidenceFingerprintSha256: quote.evidenceFingerprintSha256,
    quoteObservedAt: observedAt,
    quoteBidPrice: bidPrice,
    quoteAskPrice: askPrice,
  });
}

export function validatePaperObservedExecutionCostAttribution(
  fill: PaperObservedExecutionCostFillInput,
  quote: PaperObservedExecutionQuote,
  attribution: PaperExecutionCostAttribution,
): PaperExecutionCostAttribution {
  if (attribution.evidenceKind !== "OBSERVED") throw new PaperRuntimeExecutionCostEvidenceError("INVALID_OBSERVED_COST_ATTRIBUTION", "fill " + fill.id + " cost attribution is not observed");
  const expected = buildPaperObservedExecutionCostAttribution(fill, quote);
  if (!compareObservedAttribution(attribution, expected)) throw new PaperRuntimeExecutionCostEvidenceError("OBSERVED_COST_ATTRIBUTION_MISMATCH", "fill " + fill.id + " observed cost attribution does not match the quote");
  return expected;
}
