import test from "node:test";
import assert from "node:assert/strict";
import { compareConsecutiveLossLimits, type CompletedPaperSell } from "./consecutiveLossLimitComparison";

const DAY1 = Date.UTC(2026, 9, 7, 1, 0, 0); // 10:00 KST Oct 7
const sell = (id: string, offsetMin: number, netPnl: number, base = DAY1): CompletedPaperSell => ({ orderId: id, completedAt: base + offsetMin * 60_000, netPnl });

test("limits 3/4/5 diverge on a day with five straight losses followed by a win", () => {
  const sells = [sell("a", 0, -10), sell("b", 1, -10), sell("c", 2, -10), sell("d", 3, -10), sell("e", 4, -10), sell("f", 5, 50)];
  const [l3, l4, l5] = compareConsecutiveLossLimits(sells, [3, 4, 5]);
  assert.deepEqual({ t: l3.tradeCount, b: l3.blockedCount, n: l3.netPnl, opp: l3.opportunityLoss, av: l3.avoidedLoss }, { t: 3, b: 3, n: -30, opp: 50, av: 20 });
  assert.deepEqual({ t: l4.tradeCount, b: l4.blockedCount, n: l4.netPnl, pnl3: l4.pnlWhileStreakAtOrAboveThree }, { t: 4, b: 2, n: -40, pnl3: -10 });
  assert.deepEqual({ t: l5.tradeCount, b: l5.blockedCount, n: l5.netPnl, dd: l5.maxDrawdown }, { t: 5, b: 1, n: -50, dd: 50 });
});

test("the streak resets at the next Asia/Seoul day and a win resets it inside a day", () => {
  const next = DAY1 + 24 * 3_600_000;
  const sells = [sell("a", 0, -1), sell("b", 1, -1), sell("c", 2, 5), sell("d", 3, -1), sell("e", 4, -1), sell("f", 0, -1, next), sell("g", 1, -1, next)];
  const [l3] = compareConsecutiveLossLimits(sells, [3]);
  assert.equal(l3.blockedCount, 0);
  assert.equal(l3.tradeCount, 7);
});

test("duplicate or malformed sells never count twice, order is deterministic, and invalid limits throw", () => {
  const sells = [sell("a", 1, -5), sell("a", 1, -5), sell("b", 0, -5), { orderId: "", completedAt: DAY1, netPnl: 1 }, { orderId: "x", completedAt: Number.NaN, netPnl: 1 }];
  const first = compareConsecutiveLossLimits(sells, [3]);
  assert.equal(first[0].tradeCount, 2);
  assert.deepEqual(compareConsecutiveLossLimits([...sells].reverse(), [3]), first);
  assert.throws(() => compareConsecutiveLossLimits(sells, [0]));
  assert.throws(() => compareConsecutiveLossLimits(sells, [2.5]));
});

test("a conflicting duplicate order fails instead of depending on input order, and out-of-range timestamps are ignored", () => {
  const a = sell("a", 0, -5), b = { ...sell("a", 0, 9) };
  assert.throws(() => compareConsecutiveLossLimits([a, b], [3]));
  assert.throws(() => compareConsecutiveLossLimits([b, a], [3]));
  const bad = { orderId: "huge", completedAt: Number.MAX_VALUE, netPnl: 1 };
  assert.equal(compareConsecutiveLossLimits([bad, sell("ok", 0, -1)], [3])[0].tradeCount, 1);
});

test("limits above the limit the ledger was recorded under are flagged censored", () => {
  const sells = [sell("a", 0, -1), sell("b", 1, -1), sell("c", 2, -1), sell("d", 3, 5)];
  const [l3, l4, l5] = compareConsecutiveLossLimits(sells, [3, 4, 5]);
  assert.deepEqual([l3.censored, l4.censored, l5.censored], [false, true, true]);
  assert.equal(compareConsecutiveLossLimits(sells, [4, 5], { recordedUnderLimit: 5 }).some((r) => r.censored), false);
});
