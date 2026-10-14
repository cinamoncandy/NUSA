import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperFillRecord } from "./paperTradingExecutionLoop";
import { computeTodayRealizedPnlKrw } from "./paperTodayRealized";

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0); // 15:00 KST
const fill = (id: string, side: "BUY" | "SELL", quantity: number, price: number, fee: number, filledAt: number): PaperFillRecord =>
  ({ id, orderId: id, market: "KRW-BTC", side, quantity, price, fee, filledAt });

describe("today's realized PAPER P&L (display only)", () => {
  it("uses the average entry including buy fees and deducts the sell fee", () => {
    const fills = [fill("b", "BUY", 1, 100, 1, NOW - 3_000), fill("s", "SELL", 1, 110, 1, NOW - 1_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, NOW), 110 - 101 - 1);
  });

  it("counts only sells filled in today's KST day, even when the position was bought yesterday", () => {
    const kstMidnight = Date.UTC(2026, 9, 14, 15, 0, 0);
    const fills = [fill("b", "BUY", 2, 100, 0, kstMidnight - 10_000), fill("s1", "SELL", 1, 90, 0, kstMidnight - 5_000), fill("s2", "SELL", 1, 120, 0, kstMidnight + 5_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, kstMidnight + 10_000), 20);
    assert.equal(computeTodayRealizedPnlKrw(fills, kstMidnight - 1), -10);
  });

  it("is order-independent and reads 0 with no sells today", () => {
    const fills = [fill("s", "SELL", 1, 110, 0, NOW - 1_000), fill("b", "BUY", 1, 100, 0, NOW - 3_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, NOW), 10);
    assert.equal(computeTodayRealizedPnlKrw([fill("b", "BUY", 1, 100, 0, NOW - 3_000)], NOW), 0);
  });

  it("never guesses on an inconsistent ledger or bad numbers", () => {
    assert.equal(computeTodayRealizedPnlKrw([fill("s", "SELL", 1, 110, 0, NOW - 1_000)], NOW), null);
    assert.equal(computeTodayRealizedPnlKrw([fill("b", "BUY", 1, Number.NaN, 0, NOW - 1_000)], NOW), null);
    assert.equal(computeTodayRealizedPnlKrw([], Number.NaN), null);
  });
});
