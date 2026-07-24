const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDrawdownStatistics } = require("../dist/apps/server/src/drawdown.js");

function sample(timestamp, equity) {
  return Object.freeze({ timestamp, equity });
}

test("empty history: everything is zero/null", () => {
  const dd = computeDrawdownStatistics([]);
  assert.equal(dd.maxDrawdown, 0);
  assert.equal(dd.maxDrawdownPercent, null);
  assert.equal(dd.currentDrawdown, 0);
  assert.equal(dd.currentDrawdownPercent, null);
  assert.equal(dd.peakEquity, null);
});

test("a single sample: no drawdown, peak equals that sample", () => {
  const dd = computeDrawdownStatistics([sample(1, 1_000_000)]);
  assert.equal(dd.maxDrawdown, 0);
  assert.equal(dd.currentDrawdown, 0);
  assert.equal(dd.peakEquity, 1_000_000);
});

test("a monotonically increasing curve has zero drawdown throughout", () => {
  const dd = computeDrawdownStatistics([sample(1, 100), sample(2, 110), sample(3, 120)]);
  assert.equal(dd.maxDrawdown, 0);
  assert.equal(dd.currentDrawdown, 0);
  assert.equal(dd.peakEquity, 120);
});

test("a simple decline from a peak computes max and current drawdown identically", () => {
  const dd = computeDrawdownStatistics([sample(1, 100), sample(2, 80)]);
  assert.equal(dd.maxDrawdown, 20);
  assert.equal(dd.currentDrawdown, 20);
  assert.equal(dd.maxDrawdownPercent, 0.2);
  assert.equal(dd.currentDrawdownPercent, 0.2);
  assert.equal(dd.peakEquity, 100);
});

test("recovering to a new peak resets current drawdown to zero but preserves max drawdown", () => {
  const dd = computeDrawdownStatistics([sample(1, 100), sample(2, 80), sample(3, 130)]);
  assert.equal(dd.maxDrawdown, 20, "the earlier 100 -> 80 decline is still the largest seen");
  assert.equal(dd.currentDrawdown, 0, "130 is a new peak, so there is no current drawdown");
  assert.equal(dd.peakEquity, 130);
});

test("the largest of multiple drawdowns wins, using each one's own running peak", () => {
  const dd = computeDrawdownStatistics([
    sample(1, 100), sample(2, 90), // -10 from peak 100
    sample(3, 150), sample(4, 100) // -50 from peak 150 -- this is the larger decline
  ]);
  assert.equal(dd.maxDrawdown, 50);
  assert.equal(dd.maxDrawdownPercent, 50 / 150);
});

test("currentDrawdown reflects decline from peak to the most recent sample, mid-decline", () => {
  const dd = computeDrawdownStatistics([sample(1, 100), sample(2, 60), sample(3, 70)]);
  assert.equal(dd.maxDrawdown, 40, "100 -> 60 is still the largest decline seen");
  assert.equal(dd.currentDrawdown, 30, "peak 100, latest sample 70");
});

test("computeDrawdownStatistics never mutates its input", () => {
  const history = [sample(1, 100), sample(2, 80)];
  const before = JSON.parse(JSON.stringify(history));
  computeDrawdownStatistics(history);
  assert.deepEqual(JSON.parse(JSON.stringify(history)), before);
});

test("computeDrawdownStatistics is deterministic", () => {
  const history = [sample(1, 100), sample(2, 80), sample(3, 130), sample(4, 90)];
  const results = Array.from({ length: 5 }, () => computeDrawdownStatistics(history));
  for (const result of results) assert.deepEqual(result, results[0]);
});
