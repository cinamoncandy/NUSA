import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperAccountPosition, PaperFillRecord } from "./paperTradingExecutionLoop";
import { computeLimitReachedAt, computeTodayRealizedPnlKrw } from "./paperTodayRealized";

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0); // 15:00 KST
const fill = (id: string, side: "BUY" | "SELL", quantity: number, price: number, fee: number, filledAt: number): PaperFillRecord =>
  ({ id, orderId: id, market: "KRW-BTC", side, quantity, price, fee, filledAt });
const held = (quantity: number): PaperAccountPosition[] => [{ market: "KRW-BTC", quantity, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: 0 }];

describe("today's realized PAPER P&L (display only)", () => {
  it("uses the average entry including buy fees and deducts the sell fee", () => {
    const fills = [fill("b", "BUY", 1, 100, 1, NOW - 3_000), fill("s", "SELL", 1, 110, 1, NOW - 1_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, held(0), NOW), 110 - 101 - 1);
  });

  it("counts only sells filled in today's KST day, even when the position was bought yesterday", () => {
    const kstMidnight = Date.UTC(2026, 9, 14, 15, 0, 0);
    const fills = [fill("b", "BUY", 2, 100, 0, kstMidnight - 10_000), fill("s1", "SELL", 1, 90, 0, kstMidnight - 5_000), fill("s2", "SELL", 1, 120, 0, kstMidnight + 5_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, held(0), kstMidnight + 10_000), 20);
    assert.equal(computeTodayRealizedPnlKrw(fills, held(0), kstMidnight - 1), -10);
  });

  it("is order-independent and reads 0 with no sells today", () => {
    const fills = [fill("s", "SELL", 1, 110, 0, NOW - 1_000), fill("b", "BUY", 1, 100, 0, NOW - 3_000)];
    assert.equal(computeTodayRealizedPnlKrw(fills, held(0), NOW), 10);
    assert.equal(computeTodayRealizedPnlKrw([fill("b", "BUY", 1, 100, 0, NOW - 3_000)], held(1), NOW), 0);
  });

  it("shows nothing when retained fills no longer explain the open position (older buys dropped by the fill cap)", () => {
    // The account holds 3, but only the newest buy of 1 (plus later buy/sell) survived the cap: the average entry would be wrong.
    const truncated = [fill("b3", "BUY", 1, 200, 0, NOW - 5_000), fill("b4", "BUY", 1, 210, 0, NOW - 4_000), fill("s", "SELL", 1, 220, 0, NOW - 1_000)];
    assert.equal(computeTodayRealizedPnlKrw(truncated, held(3), NOW), null);
    assert.equal(computeTodayRealizedPnlKrw(truncated, held(1), NOW), 15, "the same fills are fine when they explain the position");
    assert.equal(computeTodayRealizedPnlKrw([fill("b", "BUY", 1, 100, 0, NOW - 3_000)], [], NOW), null, "a rebuilt position the account does not hold");
  });

  it("never guesses on an inconsistent ledger or bad numbers", () => {
    assert.equal(computeTodayRealizedPnlKrw([fill("s", "SELL", 1, 110, 0, NOW - 1_000)], held(0), NOW), null);
    assert.equal(computeTodayRealizedPnlKrw([fill("b", "BUY", 1, Number.NaN, 0, NOW - 1_000)], held(1), NOW), null);
    assert.equal(computeTodayRealizedPnlKrw([], [], Number.NaN), null);
  });
});

describe("when today's loss streak reached the limit (display only)", () => {
  // n losing round trips, one minute apart, newest ending a minute before NOW; then optionally one winning trip before them.
  const losses = (n: number, start = NOW - 60_000 * (n + 1)) => Array.from({ length: n }, (_, i) => [
    fill(`b${i}`, "BUY", 1, 100, 0, start + i * 60_000), fill(`s${i}`, "SELL", 1, 99, 0, start + i * 60_000 + 1_000),
  ]).flat();
  it("returns the fill of the loss that reached the limit, not a later loss of the same streak", () => {
    const fills = losses(4);
    const third = fills[5]!.filledAt;
    assert.equal(computeLimitReachedAt(fills, NOW, 4, 3), third);
    assert.equal(computeLimitReachedAt(losses(3), NOW, 3, 3), losses(3)[5]!.filledAt);
  });
  it("answers only when the fills agree with the gateway's streak count", () => {
    assert.equal(computeLimitReachedAt(losses(3), NOW, 2, 3), null, "below the limit");
    assert.equal(computeLimitReachedAt(losses(2), NOW, 3, 3), null, "fewer sells than the streak");
    assert.equal(computeLimitReachedAt(losses(4), NOW, 3, 3), null, "a fourth loss the gateway did not count");
    const winLast = [...losses(3), fill("bw", "BUY", 1, 100, 0, NOW - 30_000), fill("sw", "SELL", 1, 120, 0, NOW - 20_000)];
    assert.equal(computeLimitReachedAt(winLast, NOW, 3, 3), null, "the newest sell is a win");
    assert.equal(computeLimitReachedAt([fill("s", "SELL", 1, 99, 0, NOW - 1_000)], NOW, 3, 3), null, "inconsistent ledger");
  });
});
