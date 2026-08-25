const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeSignalStability } = require("../dist/apps/desktop/src/strategy/signalStabilityAnalyzer.js");

const points = Array.from({ length: 20 }, (_, index) => ({ timestamp: index + 1, close: 100 + index }));
const signal = (type, tick, reason = "test") => ({ type, reason, confidence: 1, timestamp: tick.timestamp });

test("accepts deterministic signals that are invariant to warmup offset", () => {
  const factory = () => ({ id: "stable", name: "Stable", reset() {}, onTick(tick) { return signal(tick.price >= 110 ? "BUY" : "HOLD", tick); } });
  const result = analyzeSignalStability(points, factory, { startOffsets: [2, 5], stabilizationPoints: 0, minimumComparisons: 10 });
  assert.equal(result.stable, true);
  assert.equal(result.mismatches.length, 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.mismatches));
});

test("detects signals that depend on the replay start point", () => {
  const factory = () => {
    let first;
    return { id: "sensitive", name: "Sensitive", reset() { first = undefined; }, onTick(tick) { first ??= tick.price; return signal(tick.price - first >= 10 ? "BUY" : "HOLD", tick); } };
  };
  const result = analyzeSignalStability(points, factory, { startOffsets: [5], stabilizationPoints: 0, minimumComparisons: 5 });
  assert.equal(result.stable, false);
  assert.ok(result.warnings.includes("WARMUP_SENSITIVE_SIGNALS"));
  assert.ok(result.mismatches.length > 0);
});

test("detects non-deterministic replay and insufficient evidence", () => {
  let run = 0;
  const factory = () => { const buy = run++ % 2 === 0; return { id: "unstable", name: "Unstable", reset() {}, onTick(tick) { return signal(buy ? "BUY" : "HOLD", tick); } }; };
  const result = analyzeSignalStability(points, factory, { startOffsets: [19], stabilizationPoints: 0, minimumComparisons: 5 });
  assert.equal(result.deterministicReplay, false);
  assert.ok(result.warnings.includes("NON_DETERMINISTIC_REPLAY"));
  assert.ok(result.warnings.includes("INSUFFICIENT_SIGNAL_COMPARISONS"));
});

test("rejects invalid points and offsets", () => {
  const factory = () => ({ id: "x", name: "x", reset() {}, onTick(tick) { return signal("HOLD", tick); } });
  assert.throws(() => analyzeSignalStability([], factory, { startOffsets: [1], stabilizationPoints: 0, minimumComparisons: 1 }), /requires points/);
  assert.throws(() => analyzeSignalStability(points, factory, { startOffsets: [20], stabilizationPoints: 0, minimumComparisons: 1 }), /offset/);
});
