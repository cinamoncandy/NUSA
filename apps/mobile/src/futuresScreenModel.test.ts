import assert from "node:assert/strict";
import test from "node:test";
import { buildFuturesScreen, parseFuturesSnapshot, type FuturesLimits } from "./futuresScreenModel";

const LIMITS: FuturesLimits = { maxDailyLossRatio: 0.05, minLiquidationDistanceRatio: 0.25, maxConsecutiveLosses: 3 };
const position = { symbol: "BTCUSDT", side: "LONG", quantity: 0.01, entryPrice: 100_000, markPrice: 99_000, unrealizedPnl: -1_200, liquidationDistanceRatio: 0.4 };

test("without a snapshot nothing reads as zero or healthy and the screen says it has not started", () => {
  for (const absent of [null, undefined, {}, [], "x", { positions: "no", dayLossRatio: 0.01, consecutiveLosses: 0 }]) {
    const m = buildFuturesScreen(absent, LIMITS);
    assert.equal(m.started, false);
    assert.deepEqual([...m.headline], ["선물 모의는", "시작 전이에요"]);
    assert.ok([...m.positions, ...m.usage].every((r) => r.value === "—" || r.value === "받지 못함"), "no invented numbers");
    assert.equal(m.status.find((r) => r.label === "실거래")!.value, "잠김 · 영구");
    assert.equal(m.status.find((r) => r.label === "모의 선물 거래")!.value, "시작 전");
  }
});

test("limits are shown as the fixed hints from the limits passed in", () => {
  const m = buildFuturesScreen(null, LIMITS);
  assert.deepEqual(m.usage.map((r) => r.hint), ["한도 5%", "한도 3번", "최소 25%"]);
});

test("a valid snapshot lists positions, the total and the usage against the limits", () => {
  const m = buildFuturesScreen({ positions: [position], dayLossRatio: 0.04, consecutiveLosses: 1 }, LIMITS);
  assert.equal(m.started, true);
  assert.equal(m.positions[0]!.label, "BTCUSDT 롱");
  assert.equal(m.positions[0]!.value, "−₩1,200");
  assert.equal(m.positions[0]!.tone, "LOSS");
  assert.equal(m.positions.at(-1)!.label, "평가 손익 합계");
  assert.equal(m.usage[0]!.value, "4%");
  assert.equal(m.usage[0]!.tone, "ATTENTION", "4% is at 80% of the 5% limit");
  assert.equal(m.usage[1]!.value, "1 / 3");
  assert.equal(m.usage[2]!.value, "40%");
  assert.deepEqual([...m.headline], ["선물 모의로", "배우는 중이에요"]);
});

test("a streak at the limit says it stopped; no positions reads as none, not as not received", () => {
  const m = buildFuturesScreen({ positions: [], dayLossRatio: 0, consecutiveLosses: 3 }, LIMITS);
  assert.deepEqual([...m.headline], ["선물 모의는", "쉬고 있어요"]);
  assert.equal(m.positions[0]!.value, "없음");
  assert.equal(m.usage[2]!.value, "—");
  assert.equal(m.usage[1]!.tone, "ATTENTION");
});

test("a liquidation distance under the minimum is flagged as a loss tone", () => {
  const m = buildFuturesScreen({ positions: [{ ...position, liquidationDistanceRatio: 0.1 }], dayLossRatio: 0.01, consecutiveLosses: 0 }, LIMITS);
  assert.equal(m.usage[2]!.tone, "LOSS");
});

test("malformed snapshots are rejected as a whole, never half-read", () => {
  const good = { positions: [position], dayLossRatio: 0.01, consecutiveLosses: 0 };
  assert.ok(parseFuturesSnapshot(good));
  for (const bad of [
    { ...good, dayLossRatio: 1.2 }, { ...good, dayLossRatio: Number.NaN }, { ...good, consecutiveLosses: -1 }, { ...good, consecutiveLosses: 1.5 },
    { ...good, positions: [{ ...position, side: "FLAT" }] }, { ...good, positions: [{ ...position, symbol: "btc" }] }, { ...good, positions: [{ ...position, quantity: 0 }] },
    { ...good, positions: [{ ...position, markPrice: -1 }] }, { ...good, positions: [{ ...position, liquidationDistanceRatio: 2 }] }, { ...good, positions: [null] },
  ]) assert.equal(parseFuturesSnapshot(bad), null);
});

test("usage rows carry a bar with the limit line, and an empty snapshot has no bars or reasons", () => {
  const limits = { maxDailyLossRatio: 0.05, minLiquidationDistanceRatio: 0.25, maxConsecutiveLosses: 3 };
  const pos = { symbol: "BTCUSDT", side: "LONG", quantity: 0.01, entryPrice: 96200, markPrice: 95640, unrealizedPnl: -5.6, liquidationDistanceRatio: 0.41 };
  const m = buildFuturesScreen({ positions: [pos], dayLossRatio: 0.039, consecutiveLosses: 1 }, limits);
  assert.ok(Math.abs(m.usage[0]!.bar!.fill - 0.78) < 1e-9 && m.usage[0]!.bar!.marker === 1);
  assert.deepEqual(m.usage[1]!.bar, { fill: 1 / 3, marker: 1 });
  assert.deepEqual(m.usage[2]!.bar, { fill: 0.41, marker: 0.25 });
  assert.equal(buildFuturesScreen({ positions: [pos], dayLossRatio: 0.2, consecutiveLosses: 0 }, limits).usage[0]!.bar!.fill, 1, "past the limit the bar is capped at the end");
  const empty = buildFuturesScreen(null, limits);
  assert.ok(empty.usage.every((r) => r.bar === undefined));
  assert.deepEqual(empty.reasons, []);
});

test("reason cards come only from recorded reasons, newest first; bad entries are skipped", () => {
  const limits = { maxDailyLossRatio: 0.05, minLiquidationDistanceRatio: 0.25, maxConsecutiveLosses: 3 };
  const base = { positions: [], dayLossRatio: 0, consecutiveLosses: 0 };
  const ok = (at: number) => ({ symbol: "BTCUSDT", side: "LONG", at, strategy: "추세 추종 v2", signal: 0.62, threshold: 0.55, checks: [{ label: "손실 한도", passed: true }, { label: "청산 거리", passed: false }] });
  const m = buildFuturesScreen({ ...base, reasons: [ok(Date.UTC(2026, 9, 21, 0, 0)), ok(Date.UTC(2026, 9, 21, 1, 42)), { symbol: "x", side: "LONG", at: 1, strategy: "s", checks: [] }, { ...ok(5), side: "FLAT" }, 7] }, limits);
  assert.equal(m.reasons.length, 2);
  assert.equal(m.reasons[0]!.time, "10:42");
  assert.equal(m.reasons[0]!.signal, "신호 값 0.62 (기준 0.55 이상)");
  assert.deepEqual(m.reasons[0]!.checks.map((c) => c.passed), [true, false]);
  assert.deepEqual(buildFuturesScreen(base, limits).reasons, [], "no recorded reasons means none shown");
});
