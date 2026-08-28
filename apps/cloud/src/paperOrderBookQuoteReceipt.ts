import { createHash } from "node:crypto";
import type { UpbitOrderBook } from "./upbitWebSocket";

export interface PaperOrderBookQuoteReceipt {
  readonly schemaVersion: 1;
  readonly source: "UPBIT_PUBLIC_ORDERBOOK";
  readonly market: string;
  /** Local canonical receive time. Upbit's public order-book payload currently carries no exchange timestamp. */
  readonly observedAt: number;
  readonly bestBidPrice: number;
  readonly bestAskPrice: number;
  readonly bestBidSize: number;
  readonly bestAskSize: number;
  readonly fingerprintSha256: string;
}

export class PaperOrderBookQuoteReceiptError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperOrderBookQuoteReceiptError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function safeTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PaperOrderBookQuoteReceiptError("INVALID_QUOTE_TIMESTAMP", `${field} must be a non-negative safe integer`);
  }
  return value;
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PaperOrderBookQuoteReceiptError("INVALID_ORDERBOOK_VALUE", `${field} must be finite and positive`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperOrderBookQuoteReceiptError("INVALID_ORDERBOOK_VALUE", "quote receipt contains a non-finite value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  throw new PaperOrderBookQuoteReceiptError("INVALID_ORDERBOOK_VALUE", "quote receipt contains an unsupported value");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function quoteCore(orderBook: UpbitOrderBook, observedAt: number) {
  if (orderBook.type !== "orderbook") throw new PaperOrderBookQuoteReceiptError("INVALID_ORDERBOOK", "Upbit message is not an order book");
  const market = orderBook.code.trim().toUpperCase();
  if (!market) throw new PaperOrderBookQuoteReceiptError("INVALID_MARKET", "order-book market is required");
  safeTime(observedAt, "observedAt");

  const bids = orderBook.orderbook_units
    .filter((unit) => Number.isFinite(unit.bid_size) && unit.bid_size > 0)
    .map((unit) => ({ price: positive(unit.bid_price, "bid_price"), size: positive(unit.bid_size, "bid_size") }));
  const asks = orderBook.orderbook_units
    .filter((unit) => Number.isFinite(unit.ask_size) && unit.ask_size > 0)
    .map((unit) => ({ price: positive(unit.ask_price, "ask_price"), size: positive(unit.ask_size, "ask_size") }));

  if (bids.length === 0 || asks.length === 0) {
    throw new PaperOrderBookQuoteReceiptError("MISSING_BOOK_SIDE", "order book must contain observable bid and ask liquidity");
  }

  const bestBid = bids.reduce((best, item) => item.price > best.price ? item : best);
  const bestAsk = asks.reduce((best, item) => item.price < best.price ? item : best);
  if (bestBid.price >= bestAsk.price) {
    throw new PaperOrderBookQuoteReceiptError("CROSSED_ORDERBOOK", "best bid must be strictly below best ask");
  }

  return freeze({
    schemaVersion: 1 as const,
    source: "UPBIT_PUBLIC_ORDERBOOK" as const,
    market,
    observedAt,
    bestBidPrice: bestBid.price,
    bestAskPrice: bestAsk.price,
    bestBidSize: bestBid.size,
    bestAskSize: bestAsk.size,
  });
}

/** Creates immutable point-in-time quote evidence from the already-subscribed Upbit public order-book stream. */
export function buildPaperOrderBookQuoteReceipt(orderBook: UpbitOrderBook, observedAt: number): PaperOrderBookQuoteReceipt {
  const core = quoteCore(orderBook, observedAt);
  const fingerprintSha256 = fingerprint(core);
  if (!SHA256.test(fingerprintSha256)) throw new PaperOrderBookQuoteReceiptError("INVALID_QUOTE_FINGERPRINT", "quote receipt fingerprint is invalid");
  return freeze({ ...core, fingerprintSha256 });
}

/** Recomputes identity and refuses stale, future-dated, tampered, or wrong-market quote evidence. */
export function validatePaperOrderBookQuoteReceipt(
  receipt: PaperOrderBookQuoteReceipt,
  expectedMarket: string,
  now: number,
  maximumAgeMs: number,
): PaperOrderBookQuoteReceipt {
  safeTime(now, "now");
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) {
    throw new PaperOrderBookQuoteReceiptError("INVALID_QUOTE_POLICY", "maximumAgeMs must be a non-negative safe integer");
  }
  const market = expectedMarket.trim().toUpperCase();
  if (!market || receipt.market !== market) throw new PaperOrderBookQuoteReceiptError("QUOTE_MARKET_MISMATCH", "quote receipt market does not match execution market");
  if (receipt.observedAt > now) throw new PaperOrderBookQuoteReceiptError("FUTURE_QUOTE", "quote receipt is future-dated");
  if (now - receipt.observedAt > maximumAgeMs) throw new PaperOrderBookQuoteReceiptError("STALE_QUOTE", "quote receipt is stale");
  if (receipt.schemaVersion !== 1 || receipt.source !== "UPBIT_PUBLIC_ORDERBOOK") throw new PaperOrderBookQuoteReceiptError("INVALID_QUOTE_PROVENANCE", "quote receipt provenance is invalid");
  positive(receipt.bestBidPrice, "bestBidPrice");
  positive(receipt.bestAskPrice, "bestAskPrice");
  positive(receipt.bestBidSize, "bestBidSize");
  positive(receipt.bestAskSize, "bestAskSize");
  if (receipt.bestBidPrice >= receipt.bestAskPrice) throw new PaperOrderBookQuoteReceiptError("CROSSED_ORDERBOOK", "best bid must be strictly below best ask");

  const core = freeze({
    schemaVersion: 1 as const,
    source: "UPBIT_PUBLIC_ORDERBOOK" as const,
    market: receipt.market,
    observedAt: receipt.observedAt,
    bestBidPrice: receipt.bestBidPrice,
    bestAskPrice: receipt.bestAskPrice,
    bestBidSize: receipt.bestBidSize,
    bestAskSize: receipt.bestAskSize,
  });
  const expectedFingerprint = fingerprint(core);
  if (!SHA256.test(receipt.fingerprintSha256) || receipt.fingerprintSha256 !== expectedFingerprint) {
    throw new PaperOrderBookQuoteReceiptError("QUOTE_FINGERPRINT_MISMATCH", "quote receipt fingerprint does not match canonical quote facts");
  }
  return freeze({ ...core, fingerprintSha256: expectedFingerprint });
}
