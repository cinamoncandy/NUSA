import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayPaperPeriodRule } from "./paperPeriodRuleReplay";
import { ownerBaselineStrategySpec } from "./ownerBaselinePaperStrategy";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";
import { ClosedLearningLoopStatusTracker } from "./closedLearningLoopStatus";

const SPEC = ownerBaselineStrategySpec("a".repeat(40));
const M = 60_000;
const T0 = Date.parse("2026-10-13T00:00:00.000Z");

/** One observation per minute at second 30, price from the function. */
function observations(prices: (minute: number) => number, fromMinute: number, toMinute: number) {
  const out: { observedAt: number; price: number }[] = [];
  for (let m = fromMinute; m < toMinute; m += 1) out.push({ observedAt: T0 + m * M + 30_000, price: prices(m) });
  return out;
}

// Flat, a rise (golden cross -> BUY), then a fall (dead cross -> SELL), repeated.
const wave = (m: number) => 100 + 10 * Math.sin((2 * Math.PI * m) / 120);

describe("PAPER period rule replay", () => {
  it("reproduces the live decision function bar by bar and counts round trips with fees", () => {
    const obs = observations(wave, -70, 300);
    const replay = replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0 + 240 * M, feeRate: 0.0005, readWindow: () => obs });
    assert.equal(replay.bars, 240);
    assert.ok(replay.trades >= 1, "a full sine cycle crosses down after crossing up");
    // Independent recount with the same decision function and the same 60-bar lookback.
    const closes = obs.filter((o) => o.observedAt < T0 + 240 * M).map((o) => [o.observedAt, o.price] as const);
    let entry: number | undefined; let trades = 0;
    closes.forEach(([at, price], i) => {
      if (at < T0) return;
      const d = evaluatePaperCandidateStrategy(SPEC, [], at, "KRW-XRP", closes.slice(Math.max(0, i + 1 - 60), i + 1));
      if (entry === undefined && d.action === "BUY") entry = price;
      else if (entry !== undefined && d.action === "SELL") { trades += 1; entry = undefined; }
    });
    assert.equal(replay.trades, trades);
    assert.equal(replay.openAtEnd, entry !== undefined);
  });

  it("never reads a bar at or after the period end (no look-ahead)", () => {
    const early = observations(wave, -70, 200);
    const withFuture = [...early, ...observations(() => 1, 200, 400)];
    const a = replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0 + 200 * M, feeRate: 0.0005, readWindow: () => early });
    const b = replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0 + 200 * M, feeRate: 0.0005, readWindow: () => withFuture });
    assert.deepEqual(b, a);
  });

  it("a flat market makes no trade and a zero return", () => {
    const replay = replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0 + 60 * M, feeRate: 0.0005, readWindow: () => observations(() => 100, -70, 60) });
    assert.deepEqual(replay, { bars: 60, trades: 0, closedNetReturn: 0, openMarkReturn: 0, openAtEnd: false });
  });

  it("rejects an invalid window or fee instead of guessing", () => {
    assert.throws(() => replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0, feeRate: 0.0005, readWindow: () => [] }), /WINDOW_INVALID/);
    assert.throws(() => replayPaperPeriodRule({ spec: SPEC, market: "KRW-XRP", periodStartAt: T0, periodEndAt: T0 + M, feeRate: -1, readWindow: () => [] }), /FEE_INVALID/);
  });

  it("the loop status publishes the parity in signed basis points and withdraws a malformed one", () => {
    const tracker = new ClosedLearningLoopStatusTracker(3_600_000);
    tracker.observeRollover({ status: "WAITING_FOR_EVALUATION_WINDOW" }, T0);
    tracker.observeRuleReplay({ periodId: "closed-learning-rollover:9:1", bars: 60, trades: 3, closedNetReturn: -0.0123, openMarkReturn: 0, paperNetReturn: -0.0004 });
    const evidence = tracker.snapshot()!.evidence!;
    assert.equal(evidence.replayTrades, 3);
    assert.equal(evidence.replayClosedNetBp, -123);
    assert.equal(evidence.replayPaperNetBp, -4);
    tracker.observeRuleReplay({ periodId: "x", bars: 1, trades: 0, closedNetReturn: Number.NaN, openMarkReturn: 0, paperNetReturn: 0 });
    assert.equal(tracker.snapshot()!.evidence?.replayPeriodId, undefined);
  });
});
