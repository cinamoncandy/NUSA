import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAPER_FUTURES_OWNER_LIMITS, type PaperFuturesCostProfile, type PaperFuturesOrderIntent } from "../../../../packages/contracts/src/paperFutures";
import { applyOrder, emptyPaperFuturesAccount } from "./paperFuturesSimulator";
import { assertLimitsNotLoosened, evaluatePaperFuturesOrder, futuresDailyLossState } from "./paperFuturesRiskGate";

const COSTS: PaperFuturesCostProfile = Object.freeze({ takerFeeRate: 0.0005, slippageBps: 0, maintenanceMarginRate: 0.004 });
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0);
const intent = (extra: Partial<PaperFuturesOrderIntent> = {}): PaperFuturesOrderIntent =>
  Object.freeze({ id: "o1", symbol: "BTCUSDT", side: "SHORT", quantity: 0.01, leverage: 2, marginMode: "ISOLATED", reduceOnly: false, ...extra });
const base = { markPrice: 60_000, markObservedAt: NOW - 1_000, now: NOW, maxMarkAgeMs: 10_000, startOfDayEquity: 10_000, costs: COSTS };

describe("PAPER futures risk gate", () => {
  it("keeps the owner-accepted limits: 2x, isolated, 25% liquidation distance, 3 losses", () => {
    assert.deepEqual({ ...PAPER_FUTURES_OWNER_LIMITS }, { maxLeverage: 2, minLiquidationDistanceRatio: 0.25, maxConsecutiveLosses: 3, maxDailyLossRatio: 0.05, maxPositionMarginRatio: 0.2 });
    assert.throws(() => assertLimitsNotLoosened({ ...PAPER_FUTURES_OWNER_LIMITS, maxLeverage: 3 }), /LOOSENED/);
    assert.throws(() => assertLimitsNotLoosened({ ...PAPER_FUTURES_OWNER_LIMITS, minLiquidationDistanceRatio: 0.2 }), /LOOSENED/);
    assert.throws(() => assertLimitsNotLoosened({ ...PAPER_FUTURES_OWNER_LIMITS, maxConsecutiveLosses: 4 }), /LOOSENED/);
    assert.doesNotThrow(() => assertLimitsNotLoosened({ ...PAPER_FUTURES_OWNER_LIMITS, maxLeverage: 1 }));
  });

  it("allows a small isolated 2x order and rejects leverage above 2", () => {
    assert.equal(evaluatePaperFuturesOrder({ ...base, account: emptyPaperFuturesAccount(10_000), intent: intent() }).status, "ALLOW");
    const high = evaluatePaperFuturesOrder({ ...base, account: emptyPaperFuturesAccount(10_000), intent: intent({ leverage: 3 }) });
    assert.deepEqual(high.reasonCodes, ["PAPER_FUTURES_LEVERAGE_ABOVE_LIMIT"]);
  });

  it("rejects a stale or future mark price before anything else", () => {
    for (const markObservedAt of [NOW - 20_000, NOW + 1]) {
      assert.deepEqual(evaluatePaperFuturesOrder({ ...base, markObservedAt, account: emptyPaperFuturesAccount(10_000), intent: intent() }).reasonCodes, ["PAPER_FUTURES_MARK_PRICE_STALE"]);
    }
  });

  it("caps the margin of one position at 20% of start-of-day equity", () => {
    const big = evaluatePaperFuturesOrder({ ...base, account: emptyPaperFuturesAccount(10_000), intent: intent({ quantity: 0.1 }) });
    assert.deepEqual(big.reasonCodes, ["PAPER_FUTURES_POSITION_MARGIN_ABOVE_LIMIT"]);
  });

  it("stops new exposure after 3 losing closes today but still allows reducing an open position", () => {
    let account = emptyPaperFuturesAccount(10_000);
    for (let i = 0; i < 3; i += 1) {
      const opened = applyOrder(account, intent({ id: `o${i}`, side: "LONG" }), 60_000, NOW + i * 10, COSTS);
      assert.equal(opened.status, "FILLED");
      const closed = applyOrder(opened.account, intent({ id: `c${i}`, side: "SHORT", reduceOnly: true }), 59_000, NOW + i * 10 + 1, COSTS);
      assert.equal(closed.status, "FILLED");
      account = closed.account;
    }
    assert.equal(futuresDailyLossState(account, NOW + 100).consecutiveLosses, 3);
    assert.ok(evaluatePaperFuturesOrder({ ...base, now: NOW + 100, markObservedAt: NOW + 99, account, intent: intent({ id: "n1" }) }).reasonCodes.includes("PAPER_FUTURES_CONSECUTIVE_LOSS_LIMIT"));
    const reopened = applyOrder(account, intent({ id: "r1", side: "LONG" }), 60_000, NOW + 50, COSTS);
    assert.equal(reopened.status, "FILLED");
    const reduce = evaluatePaperFuturesOrder({ ...base, now: NOW + 100, markObservedAt: NOW + 99, account: reopened.account, intent: intent({ id: "x1", side: "SHORT", reduceOnly: true }) });
    assert.equal(reduce.status, "ALLOW");
    assert.equal(futuresDailyLossState(account, Date.UTC(2026, 9, 14, 15, 0, 0)).consecutiveLosses, 0, "a new KST day resets the streak");
  });

  it("a reduce-only order that would add exposure is rejected", () => {
    assert.deepEqual(evaluatePaperFuturesOrder({ ...base, account: emptyPaperFuturesAccount(10_000), intent: intent({ reduceOnly: true }) }).reasonCodes, ["PAPER_FUTURES_REDUCE_ONLY_WOULD_INCREASE"]);
  });
});
