/**
 * A made-up PAPER futures snapshot used ONLY by the "예시 화면 보기" preview on the futures tab, so the layout can be seen before the server sends
 * real values. It is never passed off as real: the view labels it "예시" and the default view never uses it.
 */
const NOW = Date.UTC(2026, 9, 21, 1, 42); // 10:42 KST on the day this was designed
/** The preview reads the sample as if it were that moment, so its times never look like another day. */
export const FUTURES_SAMPLE_NOW = NOW + 60_000;
export const FUTURES_SAMPLE_SNAPSHOT: unknown = Object.freeze({
  positions: [
    { symbol: "BTCUSDT", side: "LONG", quantity: 0.01, entryPrice: 96200, markPrice: 95640, unrealizedPnl: -18400, liquidationDistanceRatio: 0.41 },
    { symbol: "ETHUSDT", side: "SHORT", quantity: 0.2, entryPrice: 3420, markPrice: 3388, unrealizedPnl: 6100, liquidationDistanceRatio: 0.52 },
  ],
  dayLossRatio: 0.039,
  consecutiveLosses: 1,
  reasons: [
    { symbol: "BTCUSDT", side: "LONG", at: NOW, strategy: "추세 추종 v2", signal: 0.62, threshold: 0.55, checks: [{ label: "손실 한도", passed: true }, { label: "청산 거리", passed: true }, { label: "레버리지", passed: true }, { label: "연속 손실", passed: true }] },
    { symbol: "ETHUSDT", side: "SHORT", at: NOW - 55 * 60_000, strategy: "추세 추종 v2", signal: 0.58, threshold: 0.55, checks: [{ label: "손실 한도", passed: true }, { label: "청산 거리", passed: true }, { label: "레버리지", passed: true }] },
  ],
});
