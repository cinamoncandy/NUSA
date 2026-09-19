import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PaperTradingExecutionLoop } from "./paperTradingExecutionLoop";
import type { PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";

const context = (marketPrice: number, now = 1_000) => ({
  now,
  marketPrice,
  observedAt: now,
  mode: "PAPER" as const,
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY" as const,
});

const limitOrder = (idempotencyKey: string, quantity: number, limitPrice: number): PersonalPaperOrderCommand => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey,
  market: "KRW-BTC",
  side: "BUY",
  orderType: "LIMIT",
  quantity,
  limitPrice,
});

describe("PAPER working-order execution invariants", () => {
  it("converges a capped partial fill to terminal FILLED when the remaining quantity fits the original-order liquidity cap", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, maxFillRatio: 0.5 });
    const opened = loop.openLimitOrder(limitOrder("partial-terminal", 2, 100), context(100));
    assert.equal(opened.status, "WAIT");
    const orderId = opened.state.workingOrders?.[0]?.id;
    assert.ok(orderId);

    const first = loop.fillWorkingOrder(orderId, 2, context(100, 1_001));
    assert.equal(first.status, "WAIT");
    assert.equal(first.fills[0]?.quantity, 1);
    const profile = first.state.workingOrders?.[0]?.executionProfile;
    assert.ok(profile);
    assert.equal(first.fills[0]?.executionProfileFingerprintSha256, profile.fingerprintSha256);
    assert.equal(first.fills[0]?.executionEngineVersion, profile.engineVersion);
    assert.equal(first.state.workingOrders?.[0]?.lifecycle.remainingQuantity, 1);

    const second = loop.fillWorkingOrder(orderId, 1, context(100, 1_002));
    assert.equal(second.status, "FILLED");
    assert.equal(second.fills[0]?.quantity, 1);
    assert.equal(second.orders[0]?.quantity, 2);
    assert.equal(second.orders[0]?.lifecycle?.status, "FILLED");
    assert.equal(second.state.workingOrders?.length ?? 0, 0);
  });

  it("treats a replayed fill event as a duplicate without mutating cash, fills, or lifecycle", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, maxFillRatio: 0.5 });
    const opened = loop.openLimitOrder(limitOrder("fill-idempotency", 2, 100), context(100));
    const orderId = opened.state.workingOrders?.[0]?.id;
    assert.ok(orderId);

    const first = loop.fillWorkingOrder(orderId, 2, context(100, 1_001), "exchange-event-1");
    assert.equal(first.status, "WAIT");
    const cashAfterFirst = first.state.cash;
    const filledAfterFirst = first.state.workingOrders?.[0]?.lifecycle.filledQuantity;
    const fillCountAfterFirst = first.state.fills.length;

    const replay = loop.fillWorkingOrder(orderId, 2, context(100, 1_002), "exchange-event-1");
    assert.equal(replay.status, "DUPLICATE");
    assert.equal(replay.reason, "exchange-event-1");
    assert.equal(replay.state.cash, cashAfterFirst);
    assert.equal(replay.state.fills.length, fillCountAfterFirst);
    assert.equal(replay.state.workingOrders?.[0]?.lifecycle.filledQuantity, filledAfterFirst);
    assert.equal(replay.fills[0]?.id, "fill-event:exchange-event-1");
  });

  it("enforces latencyTicks by deterministic fill-attempt sequence and persists the counter", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, latencyTicks: 2 });
    const opened = loop.openLimitOrder(limitOrder("latency-sequence", 1, 100), context(100));
    const orderId = opened.state.workingOrders?.[0]?.id;
    assert.ok(orderId);

    const tick1 = loop.fillWorkingOrder(orderId, 1, context(100, 1_001), "latency-fill");
    assert.equal(tick1.status, "WAIT");
    assert.equal(tick1.reason, "PAPER_EXECUTION_LATENCY:1/2");
    assert.equal(tick1.state.workingOrders?.[0]?.observedTicks, 1);
    assert.equal(tick1.state.fills.length, 0);

    const tick2 = loop.fillWorkingOrder(orderId, 1, context(100, 1_002), "latency-fill");
    assert.equal(tick2.status, "WAIT");
    assert.equal(tick2.reason, "PAPER_EXECUTION_LATENCY:2/2");
    assert.equal(tick2.state.workingOrders?.[0]?.observedTicks, 2);
    assert.equal(tick2.state.fills.length, 0);

    const tick3 = loop.fillWorkingOrder(orderId, 1, context(100, 1_003), "latency-fill");
    assert.equal(tick3.status, "FILLED");
    assert.equal(tick3.fills[0]?.id, "fill-event:latency-fill");
  });

  it("does not fill a BUY limit when adverse modeled execution price breaches the limit", () => {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, slippageBps: 20, spreadBps: 20 });
    const opened = loop.openLimitOrder(limitOrder("limit-protection", 1, 100), context(100));
    const orderId = opened.state.workingOrders?.[0]?.id;
    assert.ok(orderId);

    const result = loop.fillWorkingOrder(orderId, 1, context(100, 1_001));
    assert.equal(result.status, "WAIT");
    assert.equal(result.reason, "PAPER_LIMIT_MODELED_PRICE_OUTSIDE_LIMIT");
    assert.equal(result.fills.length, 0);
    assert.equal(result.state.workingOrders?.[0]?.lifecycle.filledQuantity, 0);
    assert.equal(result.state.cash, 1_000_000);
  });
});
