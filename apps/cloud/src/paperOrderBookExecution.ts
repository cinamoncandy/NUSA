import { createHash } from "node:crypto";
import {
  validatePaperObservedExecutionDepth,
  validatePaperObservedExecutionQuote,
  type PaperObservedExecutionQuote,
} from "./paperRuntimeExecutionCostEvidence";
import type { PaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";

const SHA256 = /^[a-f0-9]{64}$/;
const round8 = (value: number): number => Number(value.toFixed(8));
const floor8 = (value: number): number => Math.floor((value + Number.EPSILON) * 100_000_000) / 100_000_000;

export interface PaperOrderBookExecutionLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface PaperOrderBookExecutionReceipt {
  readonly schemaVersion: 1;
  readonly source: "UPBIT_PUBLIC_ORDERBOOK";
  readonly model: "DEPTH_VWAP_V1";
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quoteObservedAt: number;
  readonly quoteFingerprintSha256: string;
  readonly depthFingerprintSha256: string;
  readonly requestedQuantity: number;
  readonly maximumNotional: number | null;
  readonly filledQuantity: number;
  readonly vwapPrice: number;
  readonly grossNotional: number;
  readonly budgetLimited: boolean;
  readonly liquidityLimited: boolean;
  readonly consumedLevels: readonly PaperOrderBookExecutionLevel[];
  readonly fingerprintSha256: string;
}

export class PaperOrderBookExecutionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperOrderBookExecutionError";
  }
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION", `${field} must be finite and positive`);
  return value;
}

function canonicalCore(receipt: Omit<PaperOrderBookExecutionReceipt, "fingerprintSha256">) {
  return Object.freeze({
    schemaVersion: receipt.schemaVersion,
    source: receipt.source,
    model: receipt.model,
    market: receipt.market,
    side: receipt.side,
    quoteObservedAt: receipt.quoteObservedAt,
    quoteFingerprintSha256: receipt.quoteFingerprintSha256,
    depthFingerprintSha256: receipt.depthFingerprintSha256,
    requestedQuantity: receipt.requestedQuantity,
    maximumNotional: receipt.maximumNotional,
    filledQuantity: receipt.filledQuantity,
    vwapPrice: receipt.vwapPrice,
    grossNotional: receipt.grossNotional,
    budgetLimited: receipt.budgetLimited,
    liquidityLimited: receipt.liquidityLimited,
    consumedLevels: receipt.consumedLevels.map((level) => Object.freeze({ price: level.price, quantity: level.quantity })),
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function consumedTotals(levels: readonly PaperOrderBookExecutionLevel[]): Readonly<{ quantity: number; notional: number }> {
  const quantity = round8(levels.reduce((sum, level) => sum + level.quantity, 0));
  const notional = round8(levels.reduce((sum, level) => sum + level.quantity * level.price, 0));
  return Object.freeze({ quantity, notional });
}

export function buildPaperOrderBookExecutionReceipt(input: {
  readonly quote: PaperObservedExecutionQuote;
  readonly side: "BUY" | "SELL";
  readonly requestedQuantity: number;
  readonly filledAt: number;
  readonly maximumNotional?: number;
  readonly maximumFillRatio?: number;
}): PaperOrderBookExecutionReceipt {
  const quote = validatePaperObservedExecutionQuote(input.quote, input.quote.market, input.filledAt);
  const depth = validatePaperObservedExecutionDepth(quote, quote.market, input.filledAt);
  const requestedQuantity = positive(input.requestedQuantity, "requestedQuantity");
  const maximumFillRatio = input.maximumFillRatio ?? 1;
  if (!Number.isFinite(maximumFillRatio) || maximumFillRatio <= 0 || maximumFillRatio > 1) {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION", "maximumFillRatio must be in (0, 1]");
  }
  const maximumNotional = input.maximumNotional;
  if (input.side === "BUY") {
    if (maximumNotional !== undefined) positive(maximumNotional, "maximumNotional");
  } else if (maximumNotional !== undefined) {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION", "SELL execution cannot carry a maximumNotional");
  }

  const rawLevels = input.side === "BUY"
    ? depth.filter((level) => level.askSize > 0).map((level) => ({ price: level.askPrice, size: level.askSize })).sort((a, b) => a.price - b.price)
    : depth.filter((level) => level.bidSize > 0).map((level) => ({ price: level.bidPrice, size: level.bidSize })).sort((a, b) => b.price - a.price);
  if (rawLevels.length === 0) throw new PaperOrderBookExecutionError("PAPER_ORDERBOOK_LIQUIDITY_INSUFFICIENT", "public orderbook has no executable liquidity");

  let remainingQuantity = requestedQuantity;
  let remainingNotional = maximumNotional ?? Number.POSITIVE_INFINITY;
  let budgetLimited = false;
  const consumed: PaperOrderBookExecutionLevel[] = [];

  for (const level of rawLevels) {
    if (remainingQuantity <= 1e-8) break;
    const participating = floor8(level.size * maximumFillRatio);
    if (participating <= 0) continue;
    let take = Math.min(remainingQuantity, participating);
    if (Number.isFinite(remainingNotional)) {
      const affordable = floor8(remainingNotional / level.price);
      if (affordable <= 0) {
        budgetLimited = true;
        break;
      }
      if (affordable < take) {
        take = affordable;
        budgetLimited = true;
      }
    }
    take = floor8(take);
    if (take <= 0) continue;
    consumed.push(Object.freeze({ price: level.price, quantity: take }));
    remainingQuantity = round8(Math.max(0, remainingQuantity - take));
    if (Number.isFinite(remainingNotional)) {
      remainingNotional = Math.max(0, remainingNotional - take * level.price);
      if (remainingNotional <= 1e-8 && remainingQuantity > 1e-8) budgetLimited = true;
    }
  }

  if (consumed.length === 0) {
    throw new PaperOrderBookExecutionError(
      input.side === "BUY" && maximumNotional !== undefined ? "PAPER_ORDERBOOK_BUDGET_UNEXECUTABLE" : "PAPER_ORDERBOOK_LIQUIDITY_INSUFFICIENT",
      "public orderbook cannot execute any PAPER quantity"
    );
  }

  const totals = consumedTotals(consumed);
  if (totals.quantity <= 0 || totals.notional <= 0) throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION", "depth sweep produced invalid totals");
  const liquidityLimited = remainingQuantity > 1e-8 && !budgetLimited;
  const vwapPrice = round8(totals.notional / totals.quantity);
  const grossNotional = round8(totals.quantity * vwapPrice);
  if (maximumNotional !== undefined && grossNotional > maximumNotional + 1e-6) {
    throw new PaperOrderBookExecutionError("PAPER_ORDERBOOK_BUDGET_EXCEEDED", "observed depth execution exceeds PortfolioPlan capital");
  }
  const depthFingerprintSha256 = quote.depthFingerprintSha256;
  if (typeof depthFingerprintSha256 !== "string" || !SHA256.test(depthFingerprintSha256)) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_DEPTH_PROVENANCE_REQUIRED", "observed orderbook depth fingerprint is required");
  }
  const core: Omit<PaperOrderBookExecutionReceipt, "fingerprintSha256"> = Object.freeze({
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_ORDERBOOK",
    model: "DEPTH_VWAP_V1",
    market: quote.market,
    side: input.side,
    quoteObservedAt: quote.observedAt,
    quoteFingerprintSha256: quote.evidenceFingerprintSha256,
    depthFingerprintSha256,
    requestedQuantity: round8(requestedQuantity),
    maximumNotional: maximumNotional === undefined ? null : round8(maximumNotional),
    filledQuantity: totals.quantity,
    vwapPrice,
    grossNotional,
    budgetLimited,
    liquidityLimited,
    consumedLevels: Object.freeze(consumed),
  });
  return Object.freeze({ ...core, fingerprintSha256: fingerprint(canonicalCore(core)) });
}

export function validatePaperOrderBookExecutionReceipt(
  receipt: PaperOrderBookExecutionReceipt,
  input: {
    readonly market: string;
    readonly side: "BUY" | "SELL";
    readonly filledQuantity: number;
    readonly fillPrice: number;
    readonly quoteReceipt: PaperOrderBookQuoteReceipt;
    readonly intentQuantity?: number;
    readonly allocationCapital?: number;
    readonly maximumNotional?: number;
    readonly allowPartial?: boolean;
  },
): PaperOrderBookExecutionReceipt {
  if (receipt.schemaVersion !== 1 || receipt.source !== "UPBIT_PUBLIC_ORDERBOOK" || receipt.model !== "DEPTH_VWAP_V1") {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "orderbook execution receipt provenance is invalid");
  }
  if (receipt.market !== input.market.trim().toUpperCase() || receipt.side !== input.side) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_IDENTITY_MISMATCH", "orderbook execution receipt does not match fill identity");
  }
  if (!SHA256.test(receipt.quoteFingerprintSha256) || !SHA256.test(receipt.depthFingerprintSha256) || !SHA256.test(receipt.fingerprintSha256)) {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "orderbook execution receipt fingerprint is invalid");
  }
  if (receipt.quoteObservedAt !== input.quoteReceipt.observedAt || receipt.quoteFingerprintSha256 !== input.quoteReceipt.fingerprintSha256) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_QUOTE_MISMATCH", "orderbook execution receipt does not match persisted quote receipt");
  }
  positive(receipt.requestedQuantity, "receipt.requestedQuantity");
  positive(receipt.filledQuantity, "receipt.filledQuantity");
  positive(receipt.vwapPrice, "receipt.vwapPrice");
  positive(receipt.grossNotional, "receipt.grossNotional");
  if (receipt.maximumNotional !== null) {
    positive(receipt.maximumNotional, "receipt.maximumNotional");
    if (receipt.grossNotional > receipt.maximumNotional + 1e-6) {
      throw new PaperOrderBookExecutionError("PAPER_ORDERBOOK_BUDGET_EXCEEDED", "depth execution exceeds its sealed notional cap");
    }
  }
  if (typeof receipt.budgetLimited !== "boolean" || typeof receipt.liquidityLimited !== "boolean") {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "orderbook execution limitation flags are invalid");
  }
  if (receipt.filledQuantity > receipt.requestedQuantity + 1e-8) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_RECONCILIATION_MISMATCH", "orderbook execution exceeds requested quantity");
  }
  const isPartial = receipt.filledQuantity + 1e-8 < receipt.requestedQuantity;
  if (receipt.liquidityLimited !== (isPartial && !receipt.budgetLimited)) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_RECONCILIATION_MISMATCH", "orderbook liquidity limitation flag is inconsistent");
  }
  if (isPartial && receipt.liquidityLimited && input.allowPartial !== true) {
    throw new PaperOrderBookExecutionError("PAPER_ORDERBOOK_LIQUIDITY_INSUFFICIENT", "partial depth execution requires a working order");
  }
  if (!Array.isArray(receipt.consumedLevels) || receipt.consumedLevels.length === 0) {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "orderbook execution receipt has no consumed levels");
  }
  for (let index = 0; index < receipt.consumedLevels.length; index += 1) {
    const level = receipt.consumedLevels[index]!;
    positive(level.price, `receipt.consumedLevels[${index}].price`);
    positive(level.quantity, `receipt.consumedLevels[${index}].quantity`);
    if (index > 0) {
      const previous = receipt.consumedLevels[index - 1]!;
      if (receipt.side === "BUY" ? level.price < previous.price : level.price > previous.price) {
        throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "consumed orderbook levels are not in executable price order");
      }
    }
  }
  const totals = consumedTotals(receipt.consumedLevels);
  const expectedVwap = round8(totals.notional / totals.quantity);
  const expectedGross = round8(totals.quantity * expectedVwap);
  if (totals.quantity !== receipt.filledQuantity || expectedVwap !== receipt.vwapPrice || expectedGross !== receipt.grossNotional) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_RECONCILIATION_MISMATCH", "orderbook execution receipt totals do not reconcile");
  }
  if (round8(input.filledQuantity) !== receipt.filledQuantity || round8(input.fillPrice) !== receipt.vwapPrice) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_FILL_MISMATCH", "persisted PAPER fill does not match depth execution receipt");
  }
  if (receipt.side === "BUY") {
    if (receipt.consumedLevels[0]!.price !== input.quoteReceipt.bestAskPrice) throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_BEST_PRICE_MISMATCH", "BUY depth execution did not begin at best ask");
  } else if (receipt.consumedLevels[0]!.price !== input.quoteReceipt.bestBidPrice) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_BEST_PRICE_MISMATCH", "SELL depth execution did not begin at best bid");
  }
  if (input.intentQuantity !== undefined && round8(input.intentQuantity) !== receipt.requestedQuantity) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_INTENT_MISMATCH", "orderbook requested quantity does not match execution intent");
  }
  if (receipt.side === "SELL" && receipt.budgetLimited) {
    throw new PaperOrderBookExecutionError("INVALID_ORDERBOOK_EXECUTION_RECEIPT", "SELL depth execution cannot be budget limited");
  }
  const expectedMaximumNotional = input.maximumNotional ?? input.allocationCapital;
  if (receipt.side === "BUY" && expectedMaximumNotional !== undefined) {
    if (receipt.maximumNotional !== round8(expectedMaximumNotional) || receipt.grossNotional > expectedMaximumNotional + 1e-6) {
      throw new PaperOrderBookExecutionError("PAPER_ORDERBOOK_BUDGET_EXCEEDED", "BUY depth execution exceeds the approved notional cap");
    }
  }
  const core = canonicalCore({
    schemaVersion: receipt.schemaVersion,
    source: receipt.source,
    model: receipt.model,
    market: receipt.market,
    side: receipt.side,
    quoteObservedAt: receipt.quoteObservedAt,
    quoteFingerprintSha256: receipt.quoteFingerprintSha256,
    depthFingerprintSha256: receipt.depthFingerprintSha256,
    requestedQuantity: receipt.requestedQuantity,
    maximumNotional: receipt.maximumNotional,
    filledQuantity: receipt.filledQuantity,
    vwapPrice: receipt.vwapPrice,
    grossNotional: receipt.grossNotional,
    budgetLimited: receipt.budgetLimited,
    liquidityLimited: receipt.liquidityLimited,
    consumedLevels: receipt.consumedLevels,
  });
  const expectedFingerprint = fingerprint(core);
  if (receipt.fingerprintSha256 !== expectedFingerprint) {
    throw new PaperOrderBookExecutionError("ORDERBOOK_EXECUTION_FINGERPRINT_MISMATCH", "orderbook execution receipt fingerprint does not match canonical execution facts");
  }
  return Object.freeze({ ...receipt, consumedLevels: Object.freeze(receipt.consumedLevels.map((level) => Object.freeze({ ...level }))) });
}
