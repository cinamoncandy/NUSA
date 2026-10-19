import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperFuturesCostProfile } from "../../../../packages/contracts/src/paperFutures";
import { passRule, runRegimeStudy, STUDY_START_EQUITY, type StudyBar, type StudyResult } from "./futuresRegimeStudy";

const COSTS: PaperFuturesCostProfile = Object.freeze({ takerFeeRate: 0.0005, slippageBps: 0, maintenanceMarginRate: 0.004 });
const H4 = 4 * 3_600_000;
const T0 = Date.UTC(2024, 0, 1);
const bars = (closes: readonly number[], lows: Readonly<Record<number, number>> = {}): StudyBar[] =>
  closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]!;
    return { openTime: T0 + i * H4, open: o, high: Math.max(o, c), low: lows[i] ?? Math.min(o, c), close: c, closeTime: T0 + (i + 1) * H4 - 1 };
  });
// 220 flat bars at 100, then a breakout close at 110 (bar 220) and a gentle rise.
const breakout = (extra: readonly number[]): number[] => [...Array.from({ length: 220 }, () => 100), 110, ...extra];
const run = (b: StudyBar[], funding: { time: number; rate: number }[] = []) =>
  runRegimeStudy({ bars: { BTCUSDT: b }, funding: { BTCUSDT: funding }, windowStart: T0, windowEnd: T0 + b.length * H4, breakoutN: 50, costs: COSTS });

describe("futures regime study", () => {
  it("fills a breakout at the NEXT bar's open, never at the signal close", () => {
    const b = bars(breakout([111, 112, 113]));
    const r = run(b);
    assert.equal(r.roundTrips, 1);
    assert.equal(r.trades[0]!.side, "LONG");
    assert.equal(r.trades[0]!.openAt, b[221]!.openTime);
    assert.ok(Math.abs(r.trades[0]!.notional - STUDY_START_EQUITY * 0.2 * 2) < 1e-3);
  });

  it("closes on the 25-bar exit and nets fees", () => {
    const b = bars(breakout([111, 112, 90, 90]));
    const r = run(b);
    assert.equal(r.trades[0]!.closeAt, b[224]!.openTime);
    assert.ok(r.trades[0]!.netPnl < 0);
    assert.equal(r.trades[0]!.liquidated, false);
  });

  it("liquidates against the bar's adverse extreme", () => {
    const b = bars(breakout([111, 112, 113]), { 222: 40 });
    const r = run(b);
    assert.equal(r.liquidations, 1);
    assert.equal(r.trades[0]!.closeAt, b[222]!.openTime);
  });

  it("charges funding inside a held bar", () => {
    const b = bars(breakout([111, 112, 113]));
    const withFunding = run(b, [{ time: b[222]!.openTime + 1, rate: 0.01 }]);
    assert.ok(withFunding.trades[0]!.netPnl < run(b).trades[0]!.netPnl);
  });

  it("rejects bars that are not aligned across symbols", () => {
    const b = bars(breakout([111]));
    assert.throws(() => runRegimeStudy({ bars: { BTCUSDT: b, ETHUSDT: b.slice(1) }, funding: {}, windowStart: T0, windowEnd: T0 + b.length * H4, breakoutN: 50, costs: COSTS }), /STUDY_BARS_NOT_ALIGNED/);
  });

  it("passRule names every failed §6 condition", () => {
    const ok: StudyResult = { trades: [], roundTrips: 30, meanNetReturn: 0.01, pnlBySymbol: {}, profitableSymbols: 3, shortPnlInDownMonths: 1, maxDrawdown: 0.2, liquidations: 0, finalEquity: 0 };
    assert.deepEqual(passRule(ok, ok), { pass: true, failed: [] });
    const bad = { ...ok, roundTrips: 29, profitableSymbols: 2, shortPnlInDownMonths: 0, maxDrawdown: 0.21, liquidations: 1, meanNetReturn: 0 };
    assert.deepEqual([...passRule(bad, bad).failed], ["MEAN_NET_BASE", "MEAN_NET_STRESS", "ROUND_TRIPS", "SYMBOLS", "SHORT_DOWN", "DRAWDOWN", "LIQUIDATION"]);
  });
});
