import {
  buildPaperObservedExecutionCostAttribution,
  validatePaperObservedExecutionCostAttribution,
  type PaperExecutionCostAttribution,
  type PaperObservedExecutionQuote,
} from "./paperRuntimeExecutionCostEvidence";
import {
  validatePaperOrderBookQuoteReceipt,
  type PaperOrderBookQuoteReceipt,
} from "./paperOrderBookQuoteReceipt";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";

export interface PaperFillWithExecutionCostAttribution extends PaperFillRecord {
  readonly orderBookQuoteReceipt: PaperOrderBookQuoteReceipt;
  readonly executionCostAttribution: PaperExecutionCostAttribution;
}

export class PaperExecutionCostAttributionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperExecutionCostAttributionError";
  }
}

function quoteFromReceipt(receipt: PaperOrderBookQuoteReceipt): PaperObservedExecutionQuote {
  return Object.freeze({
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_ORDERBOOK",
    market: receipt.market,
    observedAt: receipt.observedAt,
    bidPrice: receipt.bestBidPrice,
    askPrice: receipt.bestAskPrice,
    evidenceId: "paper-orderbook:" + receipt.market + ":" + receipt.observedAt + ":" + receipt.fingerprintSha256.slice(0, 24),
    evidenceFingerprintSha256: receipt.fingerprintSha256,
    receipt,
  });
}

/**
 * Enriches the exact canonical PAPER fill with immutable order-book provenance and complete
 * execution-cost attribution. This adapter is evidence-only: it does not mutate an account,
 * submit an order, or grant any execution authority.
 */
export function bindPaperExecutionCostAttribution(
  fill: PaperFillRecord,
  receipt: PaperOrderBookQuoteReceipt,
  maximumQuoteAgeMs: number,
): PaperFillWithExecutionCostAttribution {
  if (fill.candidateProvenance == null) {
    throw new PaperExecutionCostAttributionError(
      "MISSING_CANDIDATE_PROVENANCE",
      `fill ${fill.id} cannot receive complete cost attribution without canonical candidate provenance`,
    );
  }

  try {
    const validatedReceipt = validatePaperOrderBookQuoteReceipt(receipt, fill.market, fill.filledAt, maximumQuoteAgeMs);
    const attribution = buildPaperObservedExecutionCostAttribution(fill, quoteFromReceipt(validatedReceipt));
    return Object.freeze({
      ...fill,
      orderBookQuoteReceipt: validatedReceipt,
      executionCostAttribution: attribution,
    });
  } catch (error) {
    const code = error != null && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "INVALID_QUOTE_RECEIPT";
    throw new PaperExecutionCostAttributionError(
      code,
      error instanceof Error ? error.message : "order-book quote receipt is invalid",
    );
  }

}

/**
 * Revalidates persisted complete attribution after restart. The quote receipt is retained with
 * the fill so the deterministic evidence fingerprint can be reconstructed rather than trusted.
 */
export function validatePersistedPaperExecutionCostAttribution(
  fill: PaperFillWithExecutionCostAttribution,
  maximumQuoteAgeMs: number,
): PaperFillWithExecutionCostAttribution {
  try {
    const receipt = validatePaperOrderBookQuoteReceipt(fill.orderBookQuoteReceipt, fill.market, fill.filledAt, maximumQuoteAgeMs);
    const attribution = validatePaperObservedExecutionCostAttribution(fill, quoteFromReceipt(receipt), fill.executionCostAttribution);
    return Object.freeze({ ...fill, orderBookQuoteReceipt: receipt, executionCostAttribution: attribution });
  } catch (error) {
    const code = error != null && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "INVALID_PERSISTED_COST_ATTRIBUTION";
    throw new PaperExecutionCostAttributionError(
      code,
      error instanceof Error ? error.message : "persisted execution-cost attribution is invalid",
    );
  }
}
