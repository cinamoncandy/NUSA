import {
  buildPaperCompletedExecutionCostEvidence,
  validatePaperCompletedExecutionCostEvidence,
  type PaperCompletedExecutionCostEvidence,
} from "./paperRuntimeExecutionCostEvidence";
import {
  validatePaperOrderBookQuoteReceipt,
  type PaperOrderBookQuoteReceipt,
} from "./paperOrderBookQuoteReceipt";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";

export interface PaperFillWithExecutionCostAttribution extends PaperFillRecord {
  readonly orderBookQuoteReceipt: PaperOrderBookQuoteReceipt;
  readonly executionCostAttribution: PaperCompletedExecutionCostEvidence;
}

export class PaperExecutionCostAttributionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperExecutionCostAttributionError";
  }
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

  let validatedReceipt: PaperOrderBookQuoteReceipt;
  try {
    validatedReceipt = validatePaperOrderBookQuoteReceipt(receipt, fill.market, fill.filledAt, maximumQuoteAgeMs);
  } catch (error) {
    const code = error != null && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "INVALID_QUOTE_RECEIPT";
    throw new PaperExecutionCostAttributionError(
      code,
      error instanceof Error ? error.message : "order-book quote receipt is invalid",
    );
  }

  const attribution = buildPaperCompletedExecutionCostEvidence(fill, validatedReceipt, maximumQuoteAgeMs);
  validatePaperCompletedExecutionCostEvidence(fill, validatedReceipt, maximumQuoteAgeMs, attribution);

  return Object.freeze({
    ...fill,
    orderBookQuoteReceipt: validatedReceipt,
    executionCostAttribution: attribution,
  });
}

/**
 * Revalidates persisted complete attribution after restart. The quote receipt is retained with
 * the fill so the deterministic evidence fingerprint can be reconstructed rather than trusted.
 */
export function validatePersistedPaperExecutionCostAttribution(
  fill: PaperFillWithExecutionCostAttribution,
  maximumQuoteAgeMs: number,
): PaperFillWithExecutionCostAttribution {
  const receipt = validatePaperOrderBookQuoteReceipt(
    fill.orderBookQuoteReceipt,
    fill.market,
    fill.filledAt,
    maximumQuoteAgeMs,
  );
  const attribution = validatePaperCompletedExecutionCostEvidence(
    fill,
    receipt,
    maximumQuoteAgeMs,
    fill.executionCostAttribution,
  );
  return Object.freeze({ ...fill, orderBookQuoteReceipt: receipt, executionCostAttribution: attribution });
}
