import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UpbitOrderBook } from "./upbitWebSocket";
import {
  PaperOrderBookQuoteReceiptError,
  buildPaperOrderBookQuoteReceipt,
  validatePaperOrderBookQuoteReceipt,
} from "./paperOrderBookQuoteReceipt";

const NOW = 1_787_933_700_000;

function orderBook(overrides: Partial<UpbitOrderBook> = {}): UpbitOrderBook {
  return Object.freeze({
    type: "orderbook",
    code: "KRW-BTC",
    total_ask_size: 4,
    total_bid_size: 5,
    orderbook_units: Object.freeze([
      Object.freeze({ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 2 }),
      Object.freeze({ ask_price: 102, bid_price: 98, ask_size: 3, bid_size: 3 }),
    ]),
    ...overrides,
  });
}

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperOrderBookQuoteReceiptError) return error.code;
    throw error;
  }
  throw new Error("expected PaperOrderBookQuoteReceiptError");
}

describe("canonical PAPER order-book quote receipt", () => {
  it("deterministically fingerprints the observed best bid/ask", () => {
    const first = buildPaperOrderBookQuoteReceipt(orderBook(), NOW);
    const replay = buildPaperOrderBookQuoteReceipt(orderBook(), NOW);
    assert.deepEqual(replay, first);
    assert.equal(first.market, "KRW-BTC");
    assert.equal(first.bestBidPrice, 99);
    assert.equal(first.bestAskPrice, 101);
    assert.equal(first.bestBidSize, 2);
    assert.equal(first.bestAskSize, 1);
    assert.match(first.fingerprintSha256, /^[a-f0-9]{64}$/);
  });

  it("derives best prices from live-liquidity levels rather than trusting array position", () => {
    const receipt = buildPaperOrderBookQuoteReceipt(orderBook({
      orderbook_units: Object.freeze([
        Object.freeze({ ask_price: 105, bid_price: 95, ask_size: 1, bid_size: 1 }),
        Object.freeze({ ask_price: 101, bid_price: 99, ask_size: 2, bid_size: 3 }),
      ]),
    }), NOW);
    assert.equal(receipt.bestBidPrice, 99);
    assert.equal(receipt.bestAskPrice, 101);
  });

  it("rejects missing liquidity on either side and crossed books", () => {
    assert.equal(codeOf(() => buildPaperOrderBookQuoteReceipt(orderBook({
      orderbook_units: Object.freeze([Object.freeze({ ask_price: 101, bid_price: 99, ask_size: 0, bid_size: 1 })]),
    }), NOW)), "MISSING_BOOK_SIDE");
    assert.equal(codeOf(() => buildPaperOrderBookQuoteReceipt(orderBook({
      orderbook_units: Object.freeze([Object.freeze({ ask_price: 100, bid_price: 100, ask_size: 1, bid_size: 1 })]),
    }), NOW)), "CROSSED_ORDERBOOK");
  });

  it("fails closed on stale, future, or wrong-market receipts", () => {
    const receipt = buildPaperOrderBookQuoteReceipt(orderBook(), NOW);
    assert.equal(codeOf(() => validatePaperOrderBookQuoteReceipt(receipt, "KRW-BTC", NOW + 1_001, 1_000)), "STALE_QUOTE");
    assert.equal(codeOf(() => validatePaperOrderBookQuoteReceipt(receipt, "KRW-BTC", NOW - 1, 1_000)), "FUTURE_QUOTE");
    assert.equal(codeOf(() => validatePaperOrderBookQuoteReceipt(receipt, "KRW-ETH", NOW, 1_000)), "QUOTE_MARKET_MISMATCH");
  });

  it("detects tampering instead of accepting mutated bid/ask evidence", () => {
    const receipt = buildPaperOrderBookQuoteReceipt(orderBook(), NOW);
    const tampered = { ...receipt, bestAskPrice: 100.5 };
    assert.equal(codeOf(() => validatePaperOrderBookQuoteReceipt(tampered, "KRW-BTC", NOW, 1_000)), "QUOTE_FINGERPRINT_MISMATCH");
  });
});
