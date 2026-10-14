import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperFuturesCostProfile } from "../../../../packages/contracts/src/paperFutures";
import { labelMonths, preregisteredVerdict, runRegimeLongShortStudy, type StudyBar, type StudyFunding, type StudyResult } from "./regimeLongShortStudy";

const BAR = 4 * 3600 * 1000;
const T0 = Date.UTC(2025, 0, 1);
const COSTS: PaperFuturesCostProfile = Object.freeze({ takerFeeRate: 0.0005, slippageBps: 5, maintenanceMarginRate: 0.004 });
const DOUBLED: PaperFuturesCostProfile = Object.freeze({ takerFeeRate: 0.001, slippageBps: 10, maintenanceMarginRate: 0.004 });

/** A trend with a small zig-zag so channels and breakouts behave like real bars. */
function series(count: number, drift: number, start = 100): StudyBar[] {
  const bars: StudyBar[] = [];
  let close = start;
  for (let i = 0; i < count; i += 1) {
    const open = close;
    close = open * (1 + drift + (i % 2 === 0 ? 0.001 : -0.001));
    bars.push([T0 + i * BAR, open, Math.max(open, close) * 1.001, Math.min(open, close) * 0.999, close]);
  }
  return bars;
}

const run = (bars: StudyBar[], funding: StudyFunding[] = [], costs = COSTS, fromIndex = 210): StudyResult =>
  runRegimeLongShortStudy({ bars: { BTCUSDT: bars }, funding: { BTCUSDT: funding }, breakoutN: 50, costs, startEquity: 10_000, fromMs: bars[fromIndex]![0], toMs: bars.at(-1)![0] + BAR, regimeSymbol: "BTCUSDT" });

describe("pre-registered regime long/short study", () => {
  it("rides a rising market long only and makes money after costs", () => {
    const result = run(series(600, 0.003));
    assert.ok(result.trades.length >= 1);
    assert.ok(result.trades.every((trade) => trade.side === "LONG"));
    assert.ok(result.finalEquity > 10_000);
    assert.equal(result.liquidations, 0);
  });

  it("goes short in a falling market, and those shorts count as DOWN-month short profit", () => {
    const result = run(series(600, -0.003));
    assert.ok(result.trades.length >= 1 && result.trades.every((trade) => trade.side === "SHORT"));
    assert.ok(result.shortNetInDownMonths > 0);
    assert.ok(Object.values(result.monthRegimes).includes("DOWN"));
  });

  it("fills on the bar after the signal, never on the signal bar, and never before fromMs", () => {
    const bars = series(600, 0.003);
    const result = run(bars, [], COSTS, 300);
    assert.ok(result.trades.length >= 1);
    for (const trade of result.trades) assert.ok(trade.openTime >= bars[301]![0], "first possible fill is the bar after the first tradable bar");
  });

  it("charges real funding: a positive rate makes a long's net smaller", () => {
    const bars = series(600, 0.003);
    const funding: StudyFunding[] = bars.filter((_, i) => i % 2 === 0).map((bar) => [bar[0], 0.001, null]);
    const free = run(bars);
    const paid = run(bars, funding);
    assert.ok(paid.finalEquity < free.finalEquity);
  });

  it("doubled costs lower the result", () => {
    const bars = series(600, 0.003);
    assert.ok(run(bars, [], DOUBLED).finalEquity < run(bars).finalEquity);
  });

  it("labels each month by its last close against the 200-bar average", () => {
    const labels = labelMonths(series(600, 0.003));
    assert.ok(Object.keys(labels).length >= 2);
    assert.ok(Object.values(labels).every((label) => label === "UP"));
  });

  it("the verdict needs every pre-registered check", () => {
    const good: StudyResult = { trades: Array.from({ length: 30 }, (_, i) => ({ symbol: "S", side: "LONG" as const, openTime: i, closeTime: i, net: 1, returnOnMargin: 0.01, liquidated: false })), meanReturnOnMargin: 0.01, netBySymbol: { A: 1, B: 1, C: 1, D: -1, E: -1 }, shortNetInDownMonths: 5, maxDrawdown: 0.1, liquidations: 0, finalEquity: 1, monthRegimes: {} };
    assert.equal(preregisteredVerdict(good, good).pass, true);
    for (const broken of [{ meanReturnOnMargin: -0.01 }, { trades: good.trades.slice(0, 29) }, { netBySymbol: { A: 1, B: 1, C: -1, D: -1, E: -1 } }, { shortNetInDownMonths: 0 }, { maxDrawdown: 0.21 }, { liquidations: 1 }]) {
      assert.equal(preregisteredVerdict({ ...good, ...broken }, good).pass, false, JSON.stringify(Object.keys(broken)));
    }
    assert.equal(preregisteredVerdict(good, { ...good, meanReturnOnMargin: 0 }).pass, false, "doubled costs must stay positive");
  });

  it("rejects an invalid breakout length", () => {
    assert.throws(() => runRegimeLongShortStudy({ bars: { BTCUSDT: series(10, 0) }, funding: {}, breakoutN: 1, costs: COSTS, startEquity: 1, fromMs: 0, toMs: 1, regimeSymbol: "BTCUSDT" }), /STUDY_BREAKOUT_N_INVALID/);
  });

  it("exits a long when the regime turns and then shorts the fall", () => {
    const up = series(400, 0.003);
    const last = up.at(-1)!;
    const down = series(400, -0.004, last[4]).map((bar, i) => [last[0] + (i + 1) * BAR, bar[1], bar[2], bar[3], bar[4]] as StudyBar);
    const result = run([...up, ...down]);
    const sides = result.trades.map((trade) => trade.side);
    assert.ok(sides.includes("LONG") && sides.includes("SHORT"), sides.join(","));
    const firstShort = result.trades.find((trade) => trade.side === "SHORT")!;
    assert.ok(result.trades.filter((trade) => trade.side === "LONG").every((trade) => trade.closeTime <= firstShort.openTime), "never long and short at once");
  });
});
